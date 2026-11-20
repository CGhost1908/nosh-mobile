import React, { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import qrcode from 'qrcode-generator';

interface QRMatrixSvgProps {
  value: string;
  size?: number;
  fgColor?: string;
  bgColor?: string;
}

export const QRMatrixSvg: React.FC<QRMatrixSvgProps> = ({
  value,
  size = 220,
  fgColor = '#0d0f12',
  bgColor = '#ffffff',
}) => {
  const { moduleCount, pathData } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value || 'nosh://sync');
    qr.make();
    const count = qr.getModuleCount();
    const quietZone = 4;
    const total = count + quietZone * 2;
    const cell = size / total;

    let d = '';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          const x = ((c + quietZone) * cell).toFixed(2);
          const y = ((r + quietZone) * cell).toFixed(2);
          const w = (cell + 0.25).toFixed(2);
          d += `M${x},${y}h${w}v${w}h-${w}z `;
        }
      }
    }
    return { moduleCount: count, pathData: d };
  }, [value, size]);

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Rect x={0} y={0} width={size} height={size} rx={12} fill={bgColor} />
      {moduleCount > 0 ? <Path d={pathData} fill={fgColor} /> : null}
    </Svg>
  );
};
