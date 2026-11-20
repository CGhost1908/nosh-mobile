import React from 'react';
import { SvgXml } from 'react-native-svg';
import iconifyData from './iconifyData.json';

export type SolarIconName = string;

interface IconifyEntry {
  body: string;
  width: number;
  height: number;
}

const ICON_MAP = iconifyData as Record<string, IconifyEntry>;

interface SolarIconProps {
  name: SolarIconName;
  size?: number;
  color?: string;
}

/**
 * Renders official Iconify SVG icons (`solar:*`, `logos:*`, `vscode-icons:*`)
 * matching Nosh Desktop (`<iconify-icon icon="...">`) pixel-for-pixel.
 */
export const SolarIcon: React.FC<SolarIconProps> = ({
  name,
  size = 20,
  color = '#f3f4f6',
}) => {
  const entry =
    ICON_MAP[name] ||
    ICON_MAP['solar:document-text-linear'];

  if (!entry) return null;

  const resolvedBody = entry.body.replace(/currentColor/g, color);
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${entry.width} ${entry.height}" width="${size}" height="${size}">${resolvedBody}</svg>`;

  return <SvgXml xml={xml} width={size} height={size} />;
};
