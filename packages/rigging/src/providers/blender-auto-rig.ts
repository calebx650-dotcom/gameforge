import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GenerationJob } from "@gameforge/shared";
import type { AutoRigProvider, AutoRigRequest, AutoRigResult } from "../auto-rig.js";

export class BlenderNotAvailableError extends Error {
  constructor() {
    super(
      "Blender was not found on PATH. Local auto-rigging runs a headless Blender " +
        "script (bpy) — install Blender (blender.org, or `apt install blender` / " +
        "`brew install --cask blender`) and make sure `blender` is on PATH.",
    );
    this.name = "BlenderNotAvailableError";
  }
}

/**
 * A minimal, dependency-free auto-rig: imports the source mesh, builds a
 * simple armature (root/spine/head, or root/spine/head + 4 limbs for a
 * humanoid), parents the mesh to it with automatic weights (Blender's
 * built-in heat-map skinning — no Rigify/Auto-Rig Pro addon required),
 * and exports the result. Good enough for placeholder/prototype rigs;
 * swapping in a fuller addon-based rig is a change to this one script,
 * not to the provider interface.
 */
const AUTO_RIG_SCRIPT = `
import bpy, sys, json

argv = sys.argv[sys.argv.index("--") + 1:]
mesh_path, output_path, rig_type, height = argv[0], argv[1], argv[2], float(argv[3])

bpy.ops.wm.read_factory_settings(use_empty=True)
if mesh_path.endswith(".glb") or mesh_path.endswith(".gltf"):
    bpy.ops.import_scene.gltf(filepath=mesh_path)
elif mesh_path.endswith(".obj"):
    bpy.ops.wm.obj_import(filepath=mesh_path)
else:
    bpy.ops.import_scene.fbx(filepath=mesh_path)

mesh_objects = [o for o in bpy.context.scene.objects if o.type == "MESH"]

bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
armature = bpy.context.object
edit_bones = armature.data.edit_bones
root = edit_bones[0]
root.name = "root"
root.head = (0, 0, 0)
root.tail = (0, 0, height * 0.5)

bone_count = 1
if rig_type == "humanoid":
    spine = edit_bones.new("spine"); spine.parent = root
    spine.head = root.tail; spine.tail = (0, 0, height * 0.8)
    head = edit_bones.new("head"); head.parent = spine
    head.head = spine.tail; head.tail = (0, 0, height)
    for side, x in (("L", -0.2), ("R", 0.2)):
        arm = edit_bones.new(f"upper_arm_{side}"); arm.parent = spine
        arm.head = (x, 0, height * 0.75); arm.tail = (x * 2, 0, height * 0.55)
        leg = edit_bones.new(f"upper_leg_{side}"); leg.parent = root
        leg.head = (x * 0.5, 0, height * 0.5); leg.tail = (x * 0.5, 0, 0)
    bone_count = len(edit_bones)

bpy.ops.object.mode_set(mode="OBJECT")
for mesh_obj in mesh_objects:
    mesh_obj.select_set(True)
armature.select_set(True)
bpy.context.view_layer.objects.active = armature
bpy.ops.object.parent_set(type="ARMATURE_AUTO")

bpy.ops.export_scene.gltf(filepath=output_path, export_format="GLB")
print("GAMEFORGE_RIG_RESULT:" + json.dumps({"bone_count": bone_count}))
`.trim();

export interface BlenderAutoRigConfig {
  /** Path to the Blender executable if it isn't named "blender" on PATH. */
  blenderPath?: string;
}

export class BlenderAutoRigProvider implements AutoRigProvider {
  readonly id = "blender-auto-rig";
  readonly displayName = "Blender (local auto-rig)";

  private readonly blenderPath: string;
  private readonly completedJobs = new Map<string, GenerationJob<AutoRigResult>>();

  constructor(config: BlenderAutoRigConfig = {}) {
    this.blenderPath = config.blenderPath ?? "blender";
  }

  async submitJob(request: AutoRigRequest): Promise<GenerationJob<AutoRigResult>> {
    const id = `blender-rig-${Date.now()}`;
    const workDir = await mkdtemp(join(tmpdir(), "gf-blender-rig-"));
    try {
      const scriptPath = join(workDir, "auto_rig.py");
      const outputPath = join(workDir, "rigged.glb");
      await writeFile(scriptPath, AUTO_RIG_SCRIPT, "utf-8");

      const stdout = await this.runBlender([
        "--background",
        "--python",
        scriptPath,
        "--",
        request.meshUrl,
        outputPath,
        request.rigType,
        String(request.heightMeters ?? 1.8),
      ]);

      const boneCount = parseBoneCount(stdout);
      const bytes = await readFile(outputPath);
      const job: GenerationJob<AutoRigResult> = {
        id,
        status: "succeeded",
        result: {
          riggedModelUrl: `data:model/gltf-binary;base64,${bytes.toString("base64")}`,
          boneCount,
          skeletonType: request.rigType,
        },
      };
      this.completedJobs.set(id, job);
      return job;
    } catch (err) {
      const job: GenerationJob<AutoRigResult> = { id, status: "failed", error: (err as Error).message };
      this.completedJobs.set(id, job);
      return job;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  async pollJob(jobId: string): Promise<GenerationJob<AutoRigResult>> {
    const job = this.completedJobs.get(jobId);
    if (!job) throw new Error(`Unknown generation job: ${jobId}`);
    return job;
  }

  private runBlender(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.blenderPath, args);
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk) => (stdout += chunk.toString()));
      child.stderr?.on("data", (chunk) => (stderr += chunk.toString()));
      child.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") reject(new BlenderNotAvailableError());
        else reject(err);
      });
      child.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`Blender exited with code ${code}: ${stderr.slice(-2000)}`));
      });
    });
  }
}

function parseBoneCount(stdout: string): number | undefined {
  const marker = "GAMEFORGE_RIG_RESULT:";
  const line = stdout.split("\n").reverse().find((l) => l.includes(marker));
  if (!line) return undefined;
  try {
    return JSON.parse(line.slice(line.indexOf(marker) + marker.length)).bone_count;
  } catch {
    return undefined;
  }
}

export async function isBlenderAvailable(blenderPath = "blender"): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(blenderPath, ["--version"]);
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}
