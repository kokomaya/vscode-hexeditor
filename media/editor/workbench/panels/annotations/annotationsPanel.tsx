// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Annotations panel: this dump's bookmarks, notes and tagged ranges in one
 * list; click to jump. (The sidebar Annotations tree stays the place for
 * management; this panel is for "investigate & annotate" layouts.)
 */

import React from "react";
import { useRecoilValue } from "recoil";
import { hexOffset } from "../../../../../shared/nvm/views/blockTreeModel";
import { EmptyState } from "../../../components/emptyState";
import * as select from "../../../state";
import { throwOnUndefinedAccessInDev } from "../../../util";
import { WorkbenchPanelProps } from "../../registry";
import _style from "./annotations.css";

const style = throwOnUndefinedAccessInDev(_style);

export const AnnotationsPanel: React.FC<WorkbenchPanelProps> = () => {
	const annotations = useRecoilValue(select.nvmAnnotationsAtom);
	const tagsById = useRecoilValue(select.nvmTagsById);
	const { bookmarks, notes, assignments } = annotations;

	if (bookmarks.length + notes.length + assignments.length === 0) {
		return (
			<EmptyState
				title="No annotations yet"
				message="Right-click bytes in the hex view to add a bookmark, a note or a tag. They show up here for quick navigation."
			/>
		);
	}

	return (
		<div className={style.panel}>
			{bookmarks.length > 0 && (
				<Section title={`Bookmarks (${bookmarks.length})`}>
					{bookmarks.map(b => (
						<Item key={b.id} offset={b.offset} label={b.label ?? "Bookmark"}>
							<button
								className={style.remove}
								title="Remove bookmark"
								onClick={e => {
									e.stopPropagation();
									select.sendAnnotationCommand({ kind: "removeBookmark", id: b.id });
								}}
							>
								×
							</button>
						</Item>
					))}
				</Section>
			)}
			{notes.length > 0 && (
				<Section title={`Notes (${notes.length})`}>
					{notes.map(n => (
						<Item key={n.id} offset={n.start} label={n.title ?? firstLine(n.body) ?? "Note"} />
					))}
				</Section>
			)}
			{assignments.length > 0 && (
				<Section title={`Tagged ranges (${assignments.length})`}>
					{assignments.map(a => {
						const tag = tagsById.get(a.tagId);
						return (
							<Item key={a.id} offset={a.start} label={tag?.label ?? a.tagId}>
								<span className={style.swatch} style={{ background: tag?.color }} />
							</Item>
						);
					})}
				</Section>
			)}
		</div>
	);
};

const firstLine = (body: string | undefined) => body?.split(/\r?\n/).find(l => l.trim())?.slice(0, 80);

const Section: React.FC<{ title: string; children?: React.ReactNode }> = ({ title, children }) => (
	<section className={style.section}>
		<h3>{title}</h3>
		<ul>{children}</ul>
	</section>
);

const Item: React.FC<{ offset: number; label: string; children?: React.ReactNode }> = ({
	offset,
	label,
	children,
}) => (
	<li className={style.item} onClick={() => select.revealNvm(offset)} title={`Go to ${hexOffset(offset)}`}>
		{children}
		<span className={style.label}>{label}</span>
		<span className={style.offset}>{hexOffset(offset)}</span>
	</li>
);
