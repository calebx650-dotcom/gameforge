import type { ToolDefinition } from "@gameforge/shared";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read the contents of a text file within the project workspace.",
    category: "read",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Path relative to the project root" } },
      required: ["path"],
    },
  },
  {
    name: "list_directory",
    description: "List files and subdirectories at a given path within the project workspace.",
    category: "read",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Path relative to the project root, default '.'" } },
    },
  },
  {
    name: "search_project",
    description: "Search project files for a text or regex pattern.",
    category: "read",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        globPattern: { type: "string", description: "Optional glob to restrict file types, e.g. '**/*.ts'" },
        maxResults: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "inspect_dependencies",
    description:
      "Look up which project files a given file imports, and which files import it back, from a real file-level import graph — useful for 'what would break if I change this' or 'where is this actually used' without reading every file. TypeScript/JavaScript only (relative imports resolved on disk); returns empty results for other languages (e.g. C#, where 'using' names a namespace, not a file, so a real answer isn't available this way).",
    category: "read",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Path relative to the project root" } },
      required: ["path"],
    },
  },
  {
    name: "create_file",
    description: "Create a new file with the given content. Fails if the file already exists.",
    category: "write",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Replace an exact string match in an existing file with new content.",
    category: "write",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        oldText: { type: "string" },
        newText: { type: "string" },
      },
      required: ["path", "oldText", "newText"],
    },
  },
  {
    name: "delete_file",
    description: "Delete a file within the project workspace.",
    category: "write",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "create_directory",
    description: "Create a directory (and parents) within the project workspace.",
    category: "write",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "run_command",
    description: "Execute a shell command inside the project workspace with a timeout.",
    category: "execution",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeoutMs: { type: "number", description: "Defaults to 30000, capped at 120000" },
      },
      required: ["command"],
    },
  },
  {
    name: "git_status",
    description: "Show the working tree status: current branch, staged/unstaged/untracked files. Read-only.",
    category: "git",
    mutating: false,
    parameters: { type: "object", properties: {} },
  },
  {
    name: "git_diff",
    description: "Show the unstaged diff for the working tree, or for a specific path. Read-only.",
    category: "git",
    mutating: false,
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Optional path to limit the diff to" } },
    },
  },
  {
    name: "git_log",
    description: "Show recent commit history (hash, author, date, message). Read-only.",
    category: "git",
    mutating: false,
    parameters: {
      type: "object",
      properties: { limit: { type: "number", description: "Max commits to return, default 20" } },
    },
  },
  {
    name: "git_branch",
    description: "List local branches and show the current branch. Read-only.",
    category: "git",
    mutating: false,
    parameters: { type: "object", properties: {} },
  },
  {
    name: "git_commit",
    description: "Stage and commit changes with a message. Modifies git history — gated by mode like any other write.",
    category: "git",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string" },
        paths: { type: "array", items: { type: "string" }, description: "Specific paths to stage; omit to stage all changes" },
      },
      required: ["message"],
    },
  },
  {
    name: "inspect_scene",
    description: "List the current engine scene's hierarchy (object paths, names, active state). Read-only.",
    category: "engine",
    mutating: false,
    parameters: { type: "object", properties: {} },
  },
  {
    name: "inspect_object",
    description: "Get full detail (transform, components) for one scene object by path. Read-only.",
    category: "engine",
    mutating: false,
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "create_object",
    description: "Create a new object in the current engine scene.",
    category: "engine",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        parentPath: { type: "string" },
        primitive: { type: "string", description: "Engine-provided primitive to start from, e.g. 'cube', 'sphere', 'empty'" },
      },
      required: ["name"],
    },
  },
  {
    name: "modify_object",
    description: "Rename or toggle active state of a scene object by path.",
    category: "engine",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        name: { type: "string" },
        active: { type: "boolean" },
      },
      required: ["path"],
    },
  },
  {
    name: "modify_transform",
    description: "Set position/rotation/scale on a scene object by path.",
    category: "engine",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        rotationEuler: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        scale: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
      },
      required: ["path"],
    },
  },
  {
    name: "modify_component",
    description: "Set properties on a component/node attached to a scene object by path.",
    category: "engine",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        componentType: { type: "string" },
        properties: { type: "object" },
      },
      required: ["path", "componentType"],
    },
  },
  {
    name: "save_scene",
    description: "Save the current engine scene.",
    category: "engine",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "enter_play_mode",
    description: "Enter play mode in the engine editor.",
    category: "engine",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "exit_play_mode",
    description: "Exit play mode in the engine editor.",
    category: "engine",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "build_project",
    description:
      "Force the engine to recompile scripts and report whether the result has compiler errors — the fast check to run after editing code, before assuming a change works. Not a full distributable player build.",
    category: "engine",
    parameters: {
      type: "object",
      properties: { target: { type: "string", description: "Engine-specific build target name" } },
    },
  },
  {
    name: "capture_screenshot",
    description:
      "Capture a screenshot of the running game/scene view for visual inspection. The image is automatically shown to you in the next turn.",
    category: "engine",
    mutating: false,
    parameters: { type: "object", properties: {} },
  },
  {
    name: "read_console",
    description: "Read recent engine console messages (log/warning/error). Read-only.",
    category: "engine",
    mutating: false,
    parameters: {
      type: "object",
      properties: { maxMessages: { type: "number", description: "Defaults to 50" } },
    },
  },
  {
    name: "run_tests",
    description:
      "Run the engine's test suite (or a filtered subset) and wait for the result — pass/fail status, progress, and failure details. Submits the run and polls internally until it settles (bounded to 5 minutes), so this one call blocks rather than requiring separate submit/poll calls. Currently Unity-only for real results (via unity-mcp's run_tests/get_test_job); no engine bridge configured, or one without a test runner, fails with a clear message.",
    category: "engine",
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["EditMode", "PlayMode"], description: "Defaults to EditMode" },
        testNames: { type: "array", items: { type: "string" } },
        groupNames: { type: "array", items: { type: "string" } },
        categoryNames: { type: "array", items: { type: "string" } },
        assemblyNames: { type: "array", items: { type: "string" } },
        includeDetails: { type: "boolean" },
        includeFailedTests: { type: "boolean" },
      },
    },
  },
  {
    name: "generate_3d_model",
    description:
      "Generate a 3D model (mesh, with an optional collision mesh) from a text prompt via a configured text-to-3D vendor (e.g. Meshy, Tripo3D). Costs money — always requires approval.",
    category: "generation",
    costsMoney: true,
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        style: { type: "string", enum: ["low-poly", "high-poly"] },
        negativePrompt: { type: "string" },
        generateCollisionMesh: { type: "boolean" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "generate_pbr_material",
    description:
      "Generate a full PBR texture set (albedo, normal, roughness, metallic) from a text prompt via a configured texture vendor. Costs money — always requires approval.",
    category: "generation",
    costsMoney: true,
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        resolution: { type: "number", enum: [512, 1024, 2048, 4096] },
        seamlessTiling: { type: "boolean" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "auto_rig_model",
    description:
      "Build a skeleton and bind it to an existing mesh (humanoid, monster, or weapon) via a configured auto-rigging vendor. Costs money — always requires approval.",
    category: "generation",
    costsMoney: true,
    parameters: {
      type: "object",
      properties: {
        meshUrl: { type: "string" },
        rigType: { type: "string", enum: ["humanoid", "quadruped", "weapon", "custom"] },
        heightMeters: { type: "number" },
      },
      required: ["meshUrl"],
    },
  },
  {
    name: "generate_motion_clip",
    description:
      "Generate or retarget an animation clip (attack, execution, wall-climb, hit-reaction, ...) via a configured AI motion vendor (e.g. DeepMotion). Costs money — always requires approval.",
    category: "generation",
    costsMoney: true,
    parameters: {
      type: "object",
      properties: {
        actionType: { type: "string", enum: ["attack", "execution", "wall-climb", "hit-reaction", "idle", "locomotion", "custom"] },
        prompt: { type: "string" },
        referenceVideoUrl: { type: "string" },
        rigType: { type: "string", enum: ["humanoid", "quadruped", "custom"] },
      },
      required: ["actionType"],
    },
  },
  {
    name: "generate_voice_line",
    description:
      "Synthesize a voice line (enemy scream, boss monologue, narrative dialogue) via a configured AI voice vendor (e.g. ElevenLabs). Costs money — always requires approval.",
    category: "generation",
    costsMoney: true,
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        voiceId: { type: "string" },
        style: { type: "string", enum: ["neutral", "scream", "whisper", "monologue", "growl"] },
      },
      required: ["text", "voiceId"],
    },
  },
  {
    name: "generate_ambient_audio",
    description:
      "Generate ambient/atmospheric music or a one-shot sound effect from a text prompt via a configured music-generation vendor (e.g. AudioCraft). Costs money — always requires approval.",
    category: "generation",
    costsMoney: true,
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        kind: { type: "string", enum: ["ambient_music", "sound_effect"] },
        durationSeconds: { type: "number" },
      },
      required: ["prompt", "kind"],
    },
  },
  {
    name: "generate_level_layout",
    description:
      "Procedurally generate a level layout (room graph, corridors, thematic decor props) for a supported horror/action theme. Purely local computation — free, no external service.",
    category: "generation",
    parameters: {
      type: "object",
      properties: {
        theme: { type: "string", enum: ["gothic_cathedral", "urban_arena", "asylum_hallway"] },
        seed: { type: "number" },
        roomCount: { type: "number" },
      },
      required: ["theme"],
    },
  },
  {
    name: "generate_boss_combat_design",
    description:
      "Generate a boss's combat behavior tree and combo transition graph from a declarative phase/attack spec. Purely local computation — free, no external service.",
    category: "generation",
    parameters: {
      type: "object",
      properties: {
        spec: {
          type: "object",
          description: "BossSpec: { name, phases: [{ name, healthThreshold, attacks: [{ name, cooldownSeconds, damage, range, comboChain? }], enraged? }] }",
        },
      },
      required: ["spec"],
    },
  },
  {
    name: "generate_shader",
    description:
      "Generate a complete Unity ShaderLab/HLSL shader (atmospheric_fog, grime_overlay, or night_vision) as text, ready to write into the project. Purely local computation — free, no external service.",
    category: "generation",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["atmospheric_fog", "grime_overlay", "night_vision"] },
        shaderName: { type: "string" },
        colorHex: { type: "string" },
      },
      required: ["kind"],
    },
  },
  {
    name: "generate_post_processing_profile",
    description:
      "Generate a themed Unity post-processing Volume profile (bloom, vignette, color grading, fog, film grain, chromatic aberration) for a level theme. Purely local computation — free, no external service.",
    category: "generation",
    parameters: {
      type: "object",
      properties: { theme: { type: "string", enum: ["gothic_cathedral", "urban_arena", "asylum_hallway"] } },
      required: ["theme"],
    },
  },
  {
    name: "export_level_geometry",
    description:
      "Convert a generated level layout into ProBuilder graybox geometry build commands (room shells, corridor floors) for a future Unity-side script to execute. Purely local computation — free, no external service.",
    category: "generation",
    parameters: {
      type: "object",
      properties: {
        layout: { type: "object", description: "A LevelLayout, as returned by generate_level_layout" },
        wallHeight: { type: "number" },
        wallThickness: { type: "number" },
      },
      required: ["layout"],
    },
  },
  {
    name: "generate_animator_controller",
    description:
      "Generate a Unity Animator Controller state-machine spec (locomotion blend tree, attack states, hit-reaction interrupt) from clip names. Purely local computation — free, no external service.",
    category: "generation",
    parameters: {
      type: "object",
      properties: {
        idleClip: { type: "string" },
        walkClip: { type: "string" },
        runClip: { type: "string" },
        attackClips: { type: "array", items: { type: "string" } },
        hitReactionClip: { type: "string" },
      },
    },
  },
  {
    name: "generate_humanoid_avatar_mapping",
    description:
      "Map arbitrary source bone names (Mixamo, Blender, or plain naming) onto Unity's Mecanim Humanoid bone slots using name-pattern heuristics. Purely local computation — free, no external service.",
    category: "generation",
    parameters: {
      type: "object",
      properties: { boneNames: { type: "array", items: { type: "string" } } },
      required: ["boneNames"],
    },
  },
  {
    name: "generate_ragdoll_config",
    description:
      "Generate ragdoll joint configuration (collider shape, mass, angular limits) per bone from a Humanoid avatar bone mapping. Purely local computation — free, no external service.",
    category: "generation",
    parameters: {
      type: "object",
      properties: {
        boneMap: { type: "object", description: "Humanoid slot -> bone name, as returned by generate_humanoid_avatar_mapping" },
      },
      required: ["boneMap"],
    },
  },
  {
    name: "set_plan",
    description:
      "Record your ordered plan for this task as a short list of steps, before making changes on anything non-trivial. Purely internal bookkeeping — visible in the activity log, doesn't touch the project. Calling it again replaces the previous plan (e.g. after re-planning mid-task).",
    category: "read",
    mutating: false,
    parameters: {
      type: "object",
      properties: { steps: { type: "array", items: { type: "string" }, description: "Ordered, short step descriptions." } },
      required: ["steps"],
    },
  },
  {
    name: "set_requirements",
    description:
      "Record the discrete, individually checkable things the user actually asked for, before starting non-trivial work — e.g. a request for 'a stamina bar that drains on sprint and regenerates' becomes separate requirements for the UI bar, the drain behavior, and the regen behavior. Each gets an id back; use update_requirement_status to mark it met/unmet once you've actually verified it, before reporting the task done. Calling this again replaces the whole list, it doesn't append.",
    category: "read",
    mutating: false,
    parameters: {
      type: "object",
      properties: { requirements: { type: "array", items: { type: "string" }, description: "One clear, checkable requirement per entry." } },
      required: ["requirements"],
    },
  },
  {
    name: "update_requirement_status",
    description:
      "Update one requirement's status by the id set_requirements returned. Only mark 'met' after actually verifying it (reading the result, running it, checking the console) — not from assuming a change worked. Use 'unmet' if you've confirmed it's NOT satisfied. Leave 'pending' (the default) for anything not yet checked, rather than guessing.",
    category: "read",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        id: { type: "number" },
        status: { type: "string", enum: ["pending", "met", "unmet"] },
        note: { type: "string", description: "Optional short note on what you actually observed." },
      },
      required: ["id", "status"],
    },
  },
  {
    name: "delegate_subtask",
    description:
      "Spawn a focused sub-agent to independently handle one delegated task, and wait for its result. Useful for a genuinely separable piece of work (e.g. 'investigate why the build fails' while you continue planning something else, or splitting a large task into independent chunks). The sub-agent shares your real project and tools but cannot delegate further (no nested chains), and has its own short iteration budget (default 5, max 8) — give it a self-contained task, not something needing your ongoing back-and-forth. Requires build or autonomous mode.",
    category: "execution",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "A clear, self-contained description of exactly what the sub-agent should do." },
        maxIterations: { type: "number", description: "Defaults to 5; capped at 8 regardless of what's requested." },
      },
      required: ["task"],
    },
  },
];

export function findToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((t) => t.name === name);
}
