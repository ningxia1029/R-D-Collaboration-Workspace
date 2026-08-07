"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

let mermaidId = 0;

function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("mermaid").then(async (mod) => {
      if (cancelled || !ref.current) return;
      const mermaid = mod.default;
      mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "loose" });
      try {
        const { svg } = await mermaid.render(`mmd-${++mermaidId}`, code);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) return <pre style={{ color: "#cf1322" }}>Mermaid 渲染失败：{error}{"\n"}{code}</pre>;
  return <div ref={ref} style={{ textAlign: "center", padding: 8 }} />;
}

/** Markdown 渲染器：GFM + mermaid 代码块 */
export default function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children }) {
            const text = String(children).replace(/\n$/, "");
            if (className === "language-mermaid") return <MermaidBlock code={text} />;
            return <code className={className}>{text}</code>;
          },
          pre({ children }) {
            return <pre>{children}</pre>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
