/**
 * INPUT:  无
 * OUTPUT: 空默认导出
 * POS:    Turbopack resolveAlias 桩模块：pdfjs-dist v3 legacy 构建内含 Node 专用的
 *         require("canvas")（浏览器永不执行，但打包器会解析），浏览器目标下别名到本空模块，
 *         避免 "Module not found: Can't resolve 'canvas'"（见 next.config.ts turbopack.resolveAlias）。
 */
const emptyStub: Record<string, never> = {};
export default emptyStub;
