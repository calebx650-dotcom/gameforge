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
];

export function findToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((t) => t.name === name);
}
