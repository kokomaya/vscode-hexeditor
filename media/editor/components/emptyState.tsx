// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Empty-state card: every empty or failed view tells the user what to do next
 * ("click here / ask this") instead of showing a blank area.
 */

import React from "react";
import { throwOnUndefinedAccessInDev } from "../util";
import _style from "./emptyState.css";

const style = throwOnUndefinedAccessInDev(_style);

export interface EmptyStateAction {
	label: string;
	onClick(): void;
	primary?: boolean;
}

export const EmptyState: React.FC<{
	title: string;
	message?: string;
	actions?: EmptyStateAction[];
}> = ({ title, message, actions }) => (
	<div className={style.emptyState}>
		<div className={style.title}>{title}</div>
		{message && <div className={style.message}>{message}</div>}
		{actions && actions.length > 0 && (
			<div className={style.actions}>
				{actions.map(a => (
					<button
						key={a.label}
						className={a.primary ? style.primaryButton : style.button}
						onClick={a.onClick}
					>
						{a.label}
					</button>
				))}
			</div>
		)}
	</div>
);
