import {formulaText} from './formulas.mjs';

// Deliberately broken model output: an extra escaping layer around Markdown
// line breaks, next to real TeX commands and a literal code escape/path.
export const newlineMarkdown='## 换行检查\n\n第一段说明。\n\n- 正例\n- 负例\n\n$$\nS(u,v)=-\\lVert u-v\\rVert_2+\\nu+\\nabla f\n$$\n\n'+formulaText+'\n\n代码 `\\n` 与路径 C:\\new\\text。';
export const escapedNewlineMarkdown=newlineMarkdown.replaceAll('\n',String.raw`\n`);
