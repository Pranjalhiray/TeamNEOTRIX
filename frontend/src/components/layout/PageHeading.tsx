import type { ReactNode } from 'react';

type PageHeadingProps = {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
};

export function PageHeading({ eyebrow, title, description, children }: PageHeadingProps) {
  return (
    <header className="workspace-page-heading">
      <div className="workspace-heading-copy">
        <p className="workspace-heading-eyebrow"><span aria-hidden="true" />{eyebrow}</p>
        <h1>{title}</h1>
        <p className="workspace-heading-description">{description}</p>
      </div>
      {children && <div className="workspace-heading-actions">{children}</div>}
    </header>
  );
}
