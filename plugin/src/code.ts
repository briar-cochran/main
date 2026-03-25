// Figma plugin main thread
// Runs in Figma's sandbox — has Figma API access but no network access.
// Receives commands from ui.html via figma.ui.onmessage.

figma.showUI(__html__, { width: 420, height: 320, title: 'Figma Slides Agent' });

const SLIDE_W = 1280;
const SLIDE_H = 720;

type CommandMessage = {
  commandId: string;
  type: string;
  params: Record<string, unknown>;
};

figma.ui.onmessage = async (msg: CommandMessage) => {
  const { commandId, type, params } = msg;
  try {
    const result = await dispatch(type, params);
    figma.ui.postMessage({ commandId, result });
  } catch (err) {
    figma.ui.postMessage({ commandId, error: (err as Error).message });
  }
};

async function dispatch(
  type: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (type) {
    case 'CREATE_SLIDE':
      return createSlide(params as CreateSlideParams);
    case 'ADD_TEXT':
      return addText(params as AddTextParams);
    case 'ADD_SHAPE':
      return addShape(params as AddShapeParams);
    case 'SET_BACKGROUND':
      return setBackground(params as SetBackgroundParams);
    case 'GET_SLIDES_INFO':
      return getSlidesInfo();
    case 'CLEAR_ALL':
      return clearAll();
    default:
      throw new Error(`Unknown command: ${type}`);
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface CreateSlideParams {
  title?: string;
  backgroundColor?: string;
}

interface AddTextParams {
  slideIndex: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  fontWeight?: 'Regular' | 'Bold' | 'Medium' | 'Semi Bold';
  color?: string;
  textAlign?: 'LEFT' | 'CENTER' | 'RIGHT';
}

interface AddShapeParams {
  slideIndex: number;
  shape: 'rectangle' | 'ellipse';
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  opacity?: number;
  cornerRadius?: number;
}

interface SetBackgroundParams {
  slideIndex: number;
  color: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSlides(): FrameNode[] {
  return figma.currentPage.children.filter(
    (n): n is FrameNode => n.type === 'FRAME',
  );
}

function getSlide(index: number): FrameNode {
  const slides = getSlides();
  const slide = slides[index];
  if (!slide) throw new Error(`Slide ${index} not found (${slides.length} total)`);
  return slide;
}

function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '').padEnd(6, '0');
  return {
    r: parseInt(clean.slice(0, 2), 16) / 255,
    g: parseInt(clean.slice(2, 4), 16) / 255,
    b: parseInt(clean.slice(4, 6), 16) / 255,
  };
}

async function loadFont(style: string): Promise<void> {
  try {
    await figma.loadFontAsync({ family: 'Inter', style });
  } catch {
    await figma.loadFontAsync({ family: 'Roboto', style: 'Regular' });
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function createSlide(
  params: CreateSlideParams,
): Promise<{ nodeId: string; slideIndex: number }> {
  await loadFont('Regular');
  await loadFont('Bold');

  const frame = figma.createFrame();
  const existingCount = getSlides().length;

  frame.name = params.title ?? `Slide ${existingCount + 1}`;
  frame.resize(SLIDE_W, SLIDE_H);
  frame.x = existingCount * (SLIDE_W + 120);
  frame.y = 0;
  frame.clipsContent = true;

  const bg = params.backgroundColor ?? '#FFFFFF';
  const { r, g, b } = hexToRgb(bg);
  frame.fills = [{ type: 'SOLID', color: { r, g, b } }];

  figma.currentPage.appendChild(frame);
  figma.viewport.scrollAndZoomIntoView([frame]);

  return { nodeId: frame.id, slideIndex: getSlides().length - 1 };
}

async function addText(
  params: AddTextParams,
): Promise<{ nodeId: string }> {
  const slide = getSlide(params.slideIndex);
  const style = params.fontWeight ?? 'Regular';
  await loadFont(style);

  const node = figma.createText();

  try {
    node.fontName = { family: 'Inter', style };
  } catch {
    node.fontName = { family: 'Roboto', style: 'Regular' };
  }

  node.fontSize = params.fontSize ?? 24;
  node.textAutoResize = 'NONE';
  node.resize(params.width, params.height);
  node.x = params.x;
  node.y = params.y;

  if (params.textAlign) {
    node.textAlignHorizontal = params.textAlign;
  }

  if (params.color) {
    const { r, g, b } = hexToRgb(params.color);
    node.fills = [{ type: 'SOLID', color: { r, g, b } }];
  }

  // Set characters AFTER font/size to avoid resize issues
  node.characters = params.text;

  slide.appendChild(node);
  return { nodeId: node.id };
}

async function addShape(
  params: AddShapeParams,
): Promise<{ nodeId: string }> {
  const slide = getSlide(params.slideIndex);

  const node: RectangleNode | EllipseNode =
    params.shape === 'ellipse'
      ? figma.createEllipse()
      : figma.createRectangle();

  node.resize(params.width, params.height);
  node.x = params.x;
  node.y = params.y;

  if (params.color) {
    const { r, g, b } = hexToRgb(params.color);
    node.fills = [{ type: 'SOLID', color: { r, g, b } }];
  }

  if (params.opacity !== undefined) {
    node.opacity = Math.max(0, Math.min(1, params.opacity));
  }

  if (params.cornerRadius !== undefined && node.type === 'RECTANGLE') {
    (node as RectangleNode).cornerRadius = params.cornerRadius;
  }

  slide.appendChild(node);
  return { nodeId: node.id };
}

async function setBackground(params: SetBackgroundParams): Promise<void> {
  const slide = getSlide(params.slideIndex);
  const { r, g, b } = hexToRgb(params.color);
  slide.fills = [{ type: 'SOLID', color: { r, g, b } }];
}

function getSlidesInfo(): {
  slides: Array<{ index: number; nodeId: string; name: string }>;
} {
  const slides = getSlides().map((n, i) => ({
    index: i,
    nodeId: n.id,
    name: n.name,
  }));
  return { slides };
}

function clearAll(): { removed: number } {
  const nodes = [...figma.currentPage.children];
  nodes.forEach((n) => n.remove());
  return { removed: nodes.length };
}
