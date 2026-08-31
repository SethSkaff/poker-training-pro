import type { ReactElement } from "react";
import type {
  TwoDAvatarAccessory,
  TwoDAvatarFaceShape,
  TwoDAvatarHairStyle,
  TwoDAvatarModel,
} from "../lib/twoDAvatarModels";

interface TwoDAvatarProps {
  model: TwoDAvatarModel;
}

function shade(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
  return `#${channels
    .map((channel) => Math.max(0, Math.min(255, channel + amount)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function facePath(shape: TwoDAvatarFaceShape): string {
  switch (shape) {
    case "round":
      return "M31 39C31 26 39 20 50 20s19 6 19 19v16c0 13-8 20-19 20s-19-7-19-20Z";
    case "square":
      return "M31 34c0-10 8-15 19-15s19 5 19 15v22c0 11-8 18-19 18s-19-7-19-18Z";
    case "angular":
      return "M32 35c2-11 8-16 18-16 11 0 17 5 19 16l-3 22c-3 11-8 16-16 16s-13-5-16-16Z";
    case "soft":
      return "M30 38c0-12 9-19 20-19s20 7 20 19v15c0 15-9 22-20 22s-20-7-20-22Z";
    case "oval":
    default:
      return "M33 37c0-12 7-18 17-18s17 6 17 18v16c0 14-7 22-17 22s-17-8-17-22Z";
  }
}

function bodyPath(shape: TwoDAvatarModel["bodyShape"]): string {
  switch (shape) {
    case "narrow":
      return "M16 100V84c0-10 9-17 22-20h24c13 3 22 10 22 20v16Z";
    case "broad":
      return "M8 100V83c0-11 12-18 27-21h30c15 3 27 10 27 21v17Z";
    case "soft":
      return "M11 100V84c0-11 10-18 24-22h30c14 4 24 11 24 22v16Z";
    case "standard":
    default:
      return "M12 100V84c0-11 11-18 24-21h28c13 3 24 10 24 21v16Z";
  }
}

function backHair(model: TwoDAvatarModel): ReactElement | null {
  const { hairColor, hairHighlight } = model;
  switch (model.hairStyle) {
    case "long":
      return (
        <path
          d="M25 45C22 23 32 11 50 11s28 12 25 34l-5 29-9-4V39H39v31l-9 4Z"
          fill={hairColor}
        />
      );
    case "waves":
      return (
        <path
          d="M24 49C18 27 30 12 49 12c20 0 34 17 27 38l-7 20H30Z"
          fill={hairColor}
        />
      );
    case "bob":
      return (
        <path
          d="M24 49c-3-21 7-35 26-35s29 14 26 35l-2 24-12-2V38H38v33l-12 2Z"
          fill={hairColor}
        />
      );
    case "ponytail":
      return (
        <>
          <path d="M67 28c12-4 19 2 17 12-2 7-8 11-16 12Z" fill={hairColor} />
          <path d="M28 52c-4-20 6-37 22-37 16 0 27 15 23 36l-8 18H34Z" fill={hairColor} />
          <path d="M73 30c4 1 7 3 9 7" fill="none" stroke={hairHighlight} strokeWidth="3" strokeLinecap="round" />
        </>
      );
    case "braid":
      return (
        <>
          <path d="M25 52c-3-21 7-37 25-37s28 16 25 37l-7 20H32Z" fill={hairColor} />
          <path d="M72 47c7 4 8 12 4 17s-2 10 2 14" fill="none" stroke={hairColor} strokeWidth="7" strokeLinecap="round" />
          <path d="M72 51c3 2 4 4 4 6M73 62c3 2 3 5 2 7" fill="none" stroke={hairHighlight} strokeWidth="2" strokeLinecap="round" />
        </>
      );
    case "bun":
      return (
        <>
          <circle cx="66" cy="16" r="9" fill={hairColor} />
          <path d="M25 49c-2-22 8-35 25-35s27 13 25 35l-7 25H32Z" fill={hairColor} />
        </>
      );
    case "curls":
      return (
        <path
          d="M25 51c-7-13 0-33 12-37 13-8 29-2 36 9 8 12 4 27-3 35l-5 17H34Z"
          fill={hairColor}
          stroke={hairHighlight}
          strokeOpacity=".45"
          strokeWidth="2"
        />
      );
    default:
      return null;
  }
}

function frontHair(model: TwoDAvatarModel): ReactElement {
  const { hairColor, hairHighlight } = model;
  switch (model.hairStyle) {
    case "fade":
      return <path d="M31 34c2-14 9-20 19-20 11 0 17 6 19 20l-6 6H37Z" fill={hairColor} />;
    case "sweep":
      return <path d="M28 36c4-19 15-24 28-21 8 2 13 7 16 15-10-3-17-1-24 5-6 5-13 6-20 4Z" fill={hairColor} />;
    case "waves":
      return (
        <path d="M27 38c0-17 10-25 23-25 12 0 22 8 23 23-5-5-10-7-16-6-7 1-13-1-19 4-4 3-7 5-11 4Z" fill={hairColor} />
      );
    case "buzz":
      return <path d="M31 34c1-11 8-17 19-17 10 0 17 6 19 17l-5 4H36Z" fill={hairColor} />;
    case "cap":
      return (
        <>
          <path d="M27 33c2-13 11-19 23-19 11 0 19 5 22 16l-5 5H33Z" fill={hairColor} />
          <path d="M27 33c12-4 28-3 44 1-9 5-22 7-35 4Z" fill={hairHighlight} />
        </>
      );
    case "side-part":
      return (
        <>
          <path d="M29 36c1-15 9-22 21-22 10 0 17 5 21 18-10-4-16-4-23-1-6 3-11 6-19 5Z" fill={hairColor} />
          <path d="M51 15c-5 5-8 10-9 17" fill="none" stroke={hairHighlight} strokeWidth="2" strokeLinecap="round" />
        </>
      );
    case "pixie":
      return <path d="M29 36c1-15 9-23 21-23 12 0 20 8 21 22-8-4-14-5-21-2-6 3-13 5-21 3Z" fill={hairColor} />;
    case "long":
      return <path d="M30 38c2-17 9-25 20-25 12 0 19 8 20 25-7-6-14-8-21-5-6 3-12 6-19 5Z" fill={hairColor} />;
    case "bob":
      return <path d="M27 39c0-17 10-25 23-25 13 0 23 8 23 25-9-6-15-8-23-6-8 2-14 5-23 6Z" fill={hairColor} />;
    case "ponytail":
      return <path d="M28 38c1-16 10-24 22-24 12 0 20 8 21 23-8-5-14-7-22-5-8 2-13 5-21 6Z" fill={hairColor} />;
    case "bun":
      return <path d="M28 38c1-16 10-24 22-24 12 0 20 8 21 23-8-5-14-7-22-5-8 2-13 5-21 6Z" fill={hairColor} />;
    case "braid":
      return <path d="M28 39c0-17 10-25 22-25s22 8 22 25c-8-6-14-8-22-6-8 2-14 5-22 6Z" fill={hairColor} />;
    case "curls":
      return <path d="M27 39c0-17 10-25 23-25 13 0 23 9 23 25-6-4-10-5-16-5-8 0-17 5-30 5Z" fill={hairColor} />;
    case "crop":
    default:
      return (
        <>
          <path d="M30 35c1-13 8-20 20-20 11 0 18 7 20 20l-5 5H35Z" fill={hairColor} />
          <path d="M37 24c5-5 11-7 18-6" fill="none" stroke={hairHighlight} strokeWidth="2" strokeLinecap="round" opacity=".55" />
        </>
      );
  }
}

function accessoryLayer(model: TwoDAvatarModel): ReactElement | null {
  const { accessory, eyeColor } = model;
  const gold = "#e7c16c";
  switch (accessory) {
    case "glasses":
      return (
        <g fill="none" stroke="#1a2631" strokeWidth="2">
          <rect x="35" y="43" width="12" height="9" rx="3" />
          <rect x="53" y="43" width="12" height="9" rx="3" />
          <path d="M47 46h6" />
        </g>
      );
    case "headset":
      return (
        <g fill="none" stroke="#263b52" strokeWidth="3" strokeLinecap="round">
          <path d="M30 45c0-16 8-25 20-25s20 9 20 25" />
          <path d="M29 44v10M71 44v10" />
        </g>
      );
    case "earrings":
      return <g fill={gold}><circle cx="29" cy="54" r="2" /><circle cx="71" cy="54" r="2" /></g>;
    case "hoops":
      return <g fill="none" stroke={gold} strokeWidth="2"><circle cx="29" cy="54" r="4" /><circle cx="71" cy="54" r="4" /></g>;
    case "cap":
      return <path d="M29 37c11-5 27-5 41 0-10 4-26 5-41 1Z" fill="#e7c16c" opacity=".75" />;
    case "none":
    default:
      return null;
  }
}

function facialHair(model: TwoDAvatarModel): ReactElement | null {
  const color = shade(model.hairColor, -8);
  switch (model.facialHair) {
    case "beard":
      return <path d="M37 59c2 9 7 14 13 14s11-5 13-14l-4 1c-5 3-13 3-18 0Z" fill={color} opacity=".86" />;
    case "goatee":
      return <path d="M45 64c2 6 8 6 10 0l3 5c-4 6-12 6-16 0Z" fill={color} opacity=".86" />;
    case "stubble":
      return <path d="M38 61c4 7 20 9 24 0v6c-6 7-18 7-24 0Z" fill={color} opacity=".48" />;
    case "none":
    default:
      return null;
  }
}

function expressionLayer(model: TwoDAvatarModel): ReactElement {
  const mouthStroke = model.gender === "female" ? "#8c4e5c" : "#673e3b";
  switch (model.expression) {
    case "smile":
      return <path d="M44 63c4 3 8 3 12 0" fill="none" stroke={mouthStroke} strokeWidth="2" strokeLinecap="round" />;
    case "confident":
      return <path d="M43 62c5 4 9 4 14 0" fill="none" stroke={mouthStroke} strokeWidth="2.4" strokeLinecap="round" />;
    case "focused":
      return <path d="M44 64h12" fill="none" stroke={mouthStroke} strokeWidth="2" strokeLinecap="round" />;
    case "calm":
    default:
      return <path d="M46 63h8" fill="none" stroke={mouthStroke} strokeWidth="1.8" strokeLinecap="round" />;
  }
}

function shirtDetail(model: TwoDAvatarModel): ReactElement {
  const dark = shade(model.shirt, -24);
  const light = model.shirtAccent;
  switch (model.shirtDetail) {
    case "collar":
      return <path d="M37 79l13 10 13-10 5 21H32Z" fill={light} opacity=".75" />;
    case "stripe":
      return <path d="M12 87h76v7H12Z" fill={light} opacity=".72" />;
    case "zip":
      return <path d="M49 78h2v22h-2Z" fill={light} opacity=".88" />;
    case "pocket":
      return <path d="M61 87h12v8H61Z" fill={dark} stroke={light} strokeOpacity=".55" />;
    case "crew":
    default:
      return <path d="M38 79c7 5 17 5 24 0" fill="none" stroke={light} strokeOpacity=".8" strokeWidth="3" />;
  }
}

/** Render one of the 100 authored, non-raster, blocky player portraits. */
export function TwoDAvatar({ model }: TwoDAvatarProps) {
  const faceShadow = shade(model.skinTone, -24);
  const shirtShadow = shade(model.shirt, -26);
  const brow = shade(model.hairColor, -10);
  return (
    <svg
      className="two-d-avatar"
      viewBox="0 0 100 100"
      data-avatar-model={model.id}
      data-avatar-gender={model.gender}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="100" height="100" rx="20" fill={model.background} />
      <path d="M0 73 24 56l16 13 18-20 42 28v23H0Z" fill={model.backgroundAccent} opacity=".38" />
      <path d="m16 17 5-5 5 5-5 5Z M78 25l3-3 3 3-3 3Z" fill={model.backgroundAccent} opacity=".64" />

      <path d={bodyPath(model.bodyShape)} fill={model.shirt} />
      <path d={bodyPath(model.bodyShape)} fill="none" stroke={shirtShadow} strokeWidth="2" opacity=".55" />
      {shirtDetail(model)}
      <path d="M40 76c4 6 16 6 20 0" fill="none" stroke={model.shirtAccent} strokeWidth="2" opacity=".68" />

      <path d="M29 44h4v13h-4ZM67 44h4v13h-4Z" fill={faceShadow} opacity=".86" />
      <path d="M42 66h16v16H42Z" fill={faceShadow} />
      {backHair(model)}
      <path d={facePath(model.faceShape)} fill={model.skinTone} stroke={faceShadow} strokeWidth="1.7" />

      <path d="M38 43c3-2 6-2 9 0M53 43c3-2 6-2 9 0" fill="none" stroke={brow} strokeWidth="2.2" strokeLinecap="round" />
      <rect x="40" y="46" width="4" height="3" rx="1" fill={model.eyeColor} />
      <rect x="56" y="46" width="4" height="3" rx="1" fill={model.eyeColor} />
      <path d="M50 49l-2 8 4 1" fill="none" stroke={faceShadow} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {expressionLayer(model)}
      {facialHair(model)}
      {frontHair(model)}
      {accessoryLayer(model)}
      <path d="M34 38c3-3 5-4 8-5" fill="none" stroke={model.hairHighlight} strokeWidth="2" strokeLinecap="round" opacity=".5" />
      <rect x="4" y="4" width="92" height="92" rx="17" fill="none" stroke="#fff" strokeOpacity=".12" strokeWidth="2" />
    </svg>
  );
}
