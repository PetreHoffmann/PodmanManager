import qrcode from "qrcode-generator";

/** QR code as an SVG data address (made here, nothing is sent to an outside service). */
export function qrDataUri(text: string): string {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  const svg = q.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
