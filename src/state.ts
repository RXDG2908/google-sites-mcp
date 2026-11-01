/**
 * Insert point shared by every gsites_add_* tool.
 *  - null  -> content is appended at the end of the page (default, original behaviour)
 *  - N>=0  -> content is inserted right after section N (0 = top of the page) and the point moves down with each insert
 */
export const insertPoint: { after: number | null } = { after: null };
