"use client";

import { memo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import "highlight.js/styles/github-dark.css";
import "katex/dist/katex.min.css";

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
        className="overflow-x-auto rounded-xl bg-[#0d1117] p-3.5 text-[13px] leading-6"
      >
        {children}
      </pre>
    </div>
  );
}

// remark-math(v6)는 $$…$$ 가 한 줄에 있으면 "인라인 수식"으로 본다. 디스플레이
// 수식(가운데 정렬·큰 적분/분수 기호)이 되려면 구분자가 별도 줄에 있어야 하는데,
// Claude는 블록 수식을 한 줄로 내보내는 경우가 많다. 한 줄을 통째로 차지하는
// $$…$$ 만 골라 줄바꿈을 넣어준다 (문장 중간의 $$ 는 건드리지 않는다).
const ONE_LINE_DISPLAY_MATH = /(^|\n)[ \t]*\$\$[ \t]*([^\n]+?)[ \t]*\$\$[ \t]*(?=\n|$)/g;

function normalizeDisplayMath(md: string): string {
  return md.replace(ONE_LINE_DISPLAY_MATH, (_m, lead: string, body: string) =>
    `${lead}$$\n${body}\n$$`,
  );
}

// 어시스턴트 답변용 마크다운 렌더러.
// 스트리밍 중 매 청크마다 다시 렌더링되므로 content가 같으면 건너뛴다(memo).
function MarkdownImpl({ content }: { content: string }) {
  return (
    <div className="prose prose-stone max-w-none break-words dark:prose-invert prose-p:my-2 prose-headings:mb-2 prose-headings:mt-4 prose-pre:my-2 prose-pre:bg-transparent prose-pre:p-0 prose-ol:my-2 prose-ul:my-2 prose-li:my-0.5 prose-table:my-2 prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown
        // remarkMath: $…$ / $$…$$ 를 수식 노드로 파싱. Claude는 수학·기술 내용을
        // 기본적으로 LaTeX로 출력하므로 이게 없으면 \frac{}{} 가 날것으로 보인다.
        remarkPlugins={[remarkGfm, remarkMath]}
        // rehypeKatex 를 먼저 — 수식을 HTML로 바꾼 뒤 코드 하이라이팅이 돌게 한다.
        // 잘못된 수식은 예외를 던지지 않고 빨간 텍스트로 표시된다(기본 동작).
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          pre: Pre,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {normalizeDisplayMath(content)}
      </ReactMarkdown>
    </div>
  );
}

const Markdown = memo(MarkdownImpl);
export default Markdown;
