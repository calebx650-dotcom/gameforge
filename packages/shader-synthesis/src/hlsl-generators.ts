export interface AtmosphericFogParams {
  shaderName?: string;
  colorHex?: string;
  density?: number;
  heightFalloff?: number;
}

/**
 * Generates a complete Unity ShaderLab file implementing height-based
 * exponential fog: fog density increases with camera distance and
 * decreases with world-space height, tuned for a low-hanging ground fog
 * look (Bloodborne's streets, Outlast's basements) rather than uniform
 * distance fog. Pure text generation — no GPU, no model, runs anywhere.
 */
export function generateAtmosphericFogShader(params: AtmosphericFogParams = {}): string {
  const name = params.shaderName ?? "GameForge/AtmosphericFog";
  const color = params.colorHex ?? "#8a8a9a";
  const density = params.density ?? 0.08;
  const heightFalloff = params.heightFalloff ?? 0.15;
  const rgb = hexToFloat3(color);

  return `Shader "${name}"
{
    Properties
    {
        _FogColor ("Fog Color", Color) = (${rgb.r}, ${rgb.g}, ${rgb.b}, 1)
        _FogDensity ("Fog Density", Range(0, 1)) = ${density}
        _HeightFalloff ("Height Falloff", Range(0, 1)) = ${heightFalloff}
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            float4 _FogColor;
            float _FogDensity;
            float _HeightFalloff;

            struct appdata { float4 vertex : POSITION; };
            struct v2f { float4 pos : SV_POSITION; float3 worldPos : TEXCOORD0; };

            v2f vert(appdata v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.worldPos = mul(unity_ObjectToWorld, v.vertex).xyz;
                return o;
            }

            fixed4 frag(v2f i) : SV_Target
            {
                float distanceFromCamera = length(_WorldSpaceCameraPos - i.worldPos);
                float heightAttenuation = exp(-max(i.worldPos.y, 0) * _HeightFalloff);
                float fogFactor = saturate(1 - exp(-distanceFromCamera * _FogDensity * heightAttenuation));
                return fixed4(_FogColor.rgb, fogFactor * _FogColor.a);
            }
            ENDHLSL
        }
    }
}
`;
}

export interface GrimeOverlayParams {
  shaderName?: string;
  grimeTextureName?: string;
  wearAmount?: number;
  edgeHighlightColorHex?: string;
}

/**
 * Generates a Unity surface shader that blends a base albedo with a
 * grime/blood/rust decal texture, driven by vertex color (paint the wear
 * mask directly in the DCC tool or procedurally) and an edge-highlight
 * term so worn edges catch a rim-light color — the "decayed fabric" /
 * "blood-crusted stone" look the spec calls for, without baking a whole
 * new PBR texture set per variation.
 */
export function generateGrimeOverlayShader(params: GrimeOverlayParams = {}): string {
  const name = params.shaderName ?? "GameForge/GrimeOverlay";
  const grimeTexture = params.grimeTextureName ?? "_GrimeTex";
  const wearAmount = params.wearAmount ?? 0.5;
  const edgeColor = params.edgeHighlightColorHex ?? "#3a2a1a";
  const rgb = hexToFloat3(edgeColor);

  return `Shader "${name}"
{
    Properties
    {
        _MainTex ("Base Albedo", 2D) = "white" {}
        ${grimeTexture} ("Grime/Decal Texture", 2D) = "black" {}
        _WearAmount ("Wear Amount", Range(0, 1)) = ${wearAmount}
        _EdgeHighlightColor ("Edge Highlight Color", Color) = (${rgb.r}, ${rgb.g}, ${rgb.b}, 1)
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" }
        CGPROGRAM
        #pragma surface surf Standard vertex:vert

        sampler2D _MainTex;
        sampler2D ${grimeTexture};
        fixed _WearAmount;
        fixed4 _EdgeHighlightColor;

        struct Input
        {
            float2 uv_MainTex;
            float2 uv_${grimeTexture};
            fixed4 color : COLOR;
            float3 viewDir;
        };

        void vert(inout appdata_full v, out Input o)
        {
            UNITY_INITIALIZE_OUTPUT(Input, o);
            o.color = v.color;
        }

        void surf(Input IN, inout SurfaceOutputStandard o)
        {
            fixed4 base = tex2D(_MainTex, IN.uv_MainTex);
            fixed4 grime = tex2D(${grimeTexture}, IN.uv_${grimeTexture});
            fixed wearMask = saturate(IN.color.r * _WearAmount);
            fixed3 blended = lerp(base.rgb, grime.rgb, wearMask);

            fixed edgeFactor = pow(1.0 - saturate(dot(normalize(IN.viewDir), o.Normal)), 3.0);
            blended = lerp(blended, _EdgeHighlightColor.rgb, edgeFactor * wearMask);

            o.Albedo = blended;
            o.Alpha = base.a;
        }
        ENDCG
    }
}
`;
}

export interface NightVisionParams {
  shaderName?: string;
  tintColorHex?: string;
  noiseIntensity?: number;
  vignetteStrength?: number;
}

/**
 * Generates a full-screen post-process HLSL shader for a night-vision /
 * low-light scanner effect (green tint, animated scan-line noise, edge
 * vignette) suitable for a Blit-based Renderer Feature in URP or a
 * Post-Processing Stack v2 custom effect.
 */
export function generateNightVisionPostProcessShader(params: NightVisionParams = {}): string {
  const name = params.shaderName ?? "GameForge/NightVision";
  const tint = params.tintColorHex ?? "#1aff4d";
  const noiseIntensity = params.noiseIntensity ?? 0.08;
  const vignetteStrength = params.vignetteStrength ?? 0.6;
  const rgb = hexToFloat3(tint);

  return `Shader "${name}"
{
    Properties
    {
        _MainTex ("Screen Texture", 2D) = "white" {}
        _TintColor ("Tint Color", Color) = (${rgb.r}, ${rgb.g}, ${rgb.b}, 1)
        _NoiseIntensity ("Noise Intensity", Range(0, 1)) = ${noiseIntensity}
        _VignetteStrength ("Vignette Strength", Range(0, 1)) = ${vignetteStrength}
    }
    SubShader
    {
        Cull Off ZWrite Off ZTest Always
        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            sampler2D _MainTex;
            fixed4 _TintColor;
            fixed _NoiseIntensity;
            fixed _VignetteStrength;

            struct appdata { float4 vertex : POSITION; float2 uv : TEXCOORD0; };
            struct v2f { float4 pos : SV_POSITION; float2 uv : TEXCOORD0; };

            v2f vert(appdata v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = v.uv;
                return o;
            }

            float rand(float2 co)
            {
                return frac(sin(dot(co, float2(12.9898, 78.233))) * 43758.5453);
            }

            fixed4 frag(v2f i) : SV_Target
            {
                fixed4 scene = tex2D(_MainTex, i.uv);
                fixed luminance = dot(scene.rgb, fixed3(0.299, 0.587, 0.114));
                fixed3 tinted = luminance * _TintColor.rgb;

                float noise = (rand(i.uv * _Time.y) - 0.5) * _NoiseIntensity;
                tinted += noise;

                float2 centered = i.uv - 0.5;
                float vignette = 1.0 - dot(centered, centered) * _VignetteStrength * 4.0;
                tinted *= saturate(vignette);

                return fixed4(tinted, scene.a);
            }
            ENDHLSL
        }
    }
}
`;
}

function hexToFloat3(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return { r: round3(r), g: round3(g), b: round3(b) };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
