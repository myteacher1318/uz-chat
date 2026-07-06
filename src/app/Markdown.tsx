"use client";

import { memo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

// 코드 블록 — 항상 어두운 배경(라이트/다크 모드 공통) + 복사 버튼
function Pre({ children }: React.HTMLAttributes<HTMLPreElement>) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    const text = preRef.current?.innerText ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 클립보드 사용 불가 — 무시 */
    }
  }

  return (
    <div className="group/code relative">
      <button
        type="button"
        onClick={copy}
        aria-label="코드 복사"
        className="absolute right-2 top-2 rounded-md bg-white/10 px-2 py-1 text-[11px] text-zinc-300 opacity-0 transition-opacity hover:bg-white/20 focus:opacity-100 group-hover/code:opacity-100"
      >
        {copied ? "복사됨 ✓" : "복사"}
      </button>
      <pre
        ref={preRef}
        className="overflow-x-auto rounded-lg bg-[#0d1117] p-3 text-[13px] leading-6"
      >
        {children}
      </pre>
    </div>
  );
}

// 어시스턴트 답변용 마크다운 렌더러.
// 스트리밍 중 매 청크마다 다시 렌더링되므로 content가 같으면 건너뛴다(memo).
function MarkdownImpl({ content }: { content: string }) {
  return (
    <div className="prose prose-zinc max-w-none break-words dark:prose-invert prose-p:my-2 prose-headings:mb-2 prose-headings:mt-4 prose-pre:my-2 prose-pre:bg-transparent prose-pre:p-0 prose-ol:my-2 prose-ul:my-2 prose-li:my-0.5 prose-table:my-2 prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: Pre,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

const Markdown = memo(MarkdownImpl);
export default Markdown;
