import { Children, memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./Markdown.module.css";

// Links leave the app for the user's browser; the shell refuses to navigate the window itself.
const components: Components = {
  a: ({ node: _, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
};

const plugins = [remarkGfm];

type RenderText = (text: string) => ReactNode;

// Plain words in paragraphs and list items go through `renderText`, such as to show app tags;
// code is left as written.
function withText(render: RenderText): Components {
  const each = (children: ReactNode) =>
    Children.map(children, (child) => (typeof child === "string" ? render(child) : child));
  return {
    ...components,
    p: ({ node: _, children, ...props }) => <p {...props}>{each(children)}</p>,
    li: ({ node: _, children, ...props }) => <li {...props}>{each(children)}</li>,
  };
}

// Agent text is rendered as markdown, never as raw HTML (D-37).
export const Markdown = memo(function Markdown({
  text,
  renderText,
}: {
  text: string;
  renderText?: RenderText | undefined;
}) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={plugins}
        components={renderText === undefined ? components : withText(renderText)}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
