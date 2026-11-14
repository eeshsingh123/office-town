import type { ReactNode } from "react";
import page from "./Page.module.css";

// The one page header: title, an optional one-line lead, the page's buttons at the top right.
export function PageHeader(props: {
  id: string;
  title: ReactNode;
  lead?: ReactNode;
  above?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={page.head}>
      <div className={page.header}>
        {props.above}
        <h1 id={props.id} className={page.title}>
          {props.title}
        </h1>
        {props.lead === undefined ? null : <p className={page.lead}>{props.lead}</p>}
      </div>
      {props.actions === undefined ? null : <div className={page.actions}>{props.actions}</div>}
    </header>
  );
}
