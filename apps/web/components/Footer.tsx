import { sx } from "@/lib/sx";

const LINKS = [
  ["LINE", "https://liff.line.me/1645278921-kWRPP32q/?accountId=178aheop"],
  ["Instagram", "https://www.instagram.com/sharlight_plantpet/"],
  ["Facebook", "https://www.facebook.com/SharlightAgritechResearch"],
] as const;

export function Footer() {
  return (
    <footer style={sx("border-top:1px solid #2a3358")}>
      <div
        className="gutter"
        style={sx(
          "max-width:1240px;margin:0 auto;padding:28px clamp(16px,4vw,40px);display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;font-size:14px;color:#aeb0c6",
          { paddingBottom: "calc(28px + env(safe-area-inset-bottom, 0px))" },
        )}
      >
        <span>十二星球 · 星球寶寶由芯宸農業燈泡植栽培育</span>
        <span>
          {LINKS.map(([label, href], i) => (
            <span key={label}>
              {i > 0 && " · "}
              <a href={href} target="_blank" rel="noopener noreferrer" className="h-text-gold tap-inline tap-sq" style={sx("color:#aeb0c6;text-decoration:none")}>
                {label}
              </a>
            </span>
          ))}
        </span>
      </div>
    </footer>
  );
}
