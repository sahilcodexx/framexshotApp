export { usePreviewGenerator, loadImage } from "./usePreviewGenerator";
export type { PreviewGeneratorOptions, PreviewGeneratorResult } from "./usePreviewGenerator";

// `useEditorState`, `useEditorSettings` and `useHistory` used to be exported
// here. They were superseded by the Zustand store in `@/stores/editorStore` and
// kept "for backwards compatibility" — but nothing imported them, this is an
// application rather than a published package, and they were the only remaining
// source of several React Compiler lint findings. They have been removed;
// `git log` has them if they are ever needed again.
//
// `ShadowSettings` was duplicated verbatim across all three. The definition in
// `@/stores/editorStore` is the canonical one and is what every live caller uses.
