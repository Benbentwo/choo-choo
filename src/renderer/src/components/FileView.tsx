import { useEffect, useRef, useState } from "react";
import type { FilePreview, Workspace } from "@shared/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FindBar } from "./FindBar";
import { COMPONENTS, MdViewSwitch } from "./MarkdownDiff";
import { ImageFile } from "./ImageDiff";
import { isImageFile, isSvgFile } from "@shared/images";
import {
  getMdView,
  isMarkdownFile,
  saveMdView,
  type MdView,
} from "../mdPreview";

export function FileView({
  ws,
  file,
  line,
}: {
  ws: Workspace;
  file: string;
  line?: number;
}) {
  const [f, setF] = useState<FilePreview | null>(null);
  const target = useRef<HTMLTableRowElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Markdown files read as the rendered document; opened at a line (a finding, a link) they show the source there.
  const markdown = isMarkdownFile(file);
  // PNGs and SVGs show as the picture; an SVG's source is one click away (Code).
  const svg = isSvgFile(file);
  const [svgView, setSvgView] = useState<MdView>(line ? "code" : "preview");
  const image = isImageFile(file) && (!svg || svgView === "preview");
  const [view, setViewState] = useState<MdView>(() =>
    line ? "code" : getMdView(),
  );
  const setView = (v: MdView) => {
    saveMdView(v);
    setViewState(v);
  };
  const preview = markdown && view === "preview";
  useEffect(
    () => target.current?.scrollIntoView({ block: "center" }),
    [f, line],
  );
  useEffect(() => {
    setF(null);
    void window.api
      .readFile(ws.id, file)
      .then(setF, (e) =>
        setF({ path: file, content: null, reason: String(e) }),
      );
  }, [ws.id, file]);

  if (image)
    return (
      <div className="selectable flex-1 overflow-auto font-mono text-[12px] leading-[20px] [container-type:inline-size]">
        <div className="sticky top-0 left-0 z-10 flex h-[34px] w-[100cqw] items-center gap-3 border-b border-line bg-panel px-4 text-muted">
          <span className="min-w-0 flex-1 truncate">{file}</span>
          {svg && <SvgSwitch image onChange={setSvgView} />}
        </div>
        <ImageFile ws={ws} file={file} />
      </div>
    );
  if (!f) return <div className="flex-1 p-6 text-faint">Loading…</div>;
  if (f.content === null)
    return <div className="flex-1 p-6 text-faint">{f.reason}</div>;
  const lines = f.content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return (
    <div
      ref={box}
      className="selectable flex-1 overflow-auto font-mono text-[12px] leading-[20px] [container-type:inline-size]"
    >
      <div className="sticky top-0 left-0 z-10 flex h-[34px] w-[100cqw] items-center gap-3 border-b border-line bg-panel px-4 text-muted">
        <span className="min-w-0 flex-1 truncate">{file}</span>
        {markdown && <MdViewSwitch preview={preview} onChange={setView} />}
        {svg && <SvgSwitch image={false} onChange={setSvgView} />}
        <FindBar box={box} watch={f} />
      </div>
      {preview ? (
        <div
          data-find
          className="prose-chat md-preview max-w-3xl px-8 py-4 font-sans text-[13px] leading-normal"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
            {f.content}
          </ReactMarkdown>
        </div>
      ) : (
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((l, i) => (
              <tr
                key={i}
                ref={i + 1 === line ? target : undefined}
                className={i + 1 === line ? "bg-accent/15" : undefined}
              >
                <td className="w-12 pr-3 text-right align-top text-faint select-none">
                  {i + 1}
                </td>
                <td data-find className="pr-4 whitespace-pre">
                  {l}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SvgSwitch({
  image,
  onChange,
}: {
  image: boolean;
  onChange: (v: MdView) => void;
}) {
  return (
    <MdViewSwitch
      preview={image}
      onChange={onChange}
      titles={{
        preview: "The image. Click it to open it full size.",
        code: "The SVG source, line by line",
      }}
    />
  );
}
