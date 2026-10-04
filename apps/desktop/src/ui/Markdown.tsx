import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./Markdown.module.css";

// Links leave the app for the user's browser; the shell refuses to navigate the window itself.
const components: Components = {
  a: ({ node: _, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
};

const plugins = [remarkGfm];

// Agent text is rendered as markdown, never as raw HTML (D-37).
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
