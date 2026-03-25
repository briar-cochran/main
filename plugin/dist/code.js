"use strict";
(() => {
  // src/code.ts
  figma.showUI(__html__, { width: 420, height: 320, title: "Figma Slides Agent" });
  var SLIDE_W = 1280;
  var SLIDE_H = 720;
  figma.ui.onmessage = async (msg) => {
    const { commandId, type, params } = msg;
    try {
      const result = await dispatch(type, params);
      figma.ui.postMessage({ commandId, result });
    } catch (err) {
      figma.ui.postMessage({ commandId, error: err.message });
    }
  };
  async function dispatch(type, params) {
    switch (type) {
      case "CREATE_SLIDE":
        return createSlide(params);
      case "ADD_TEXT":
        return addText(params);
      case "ADD_SHAPE":
        return addShape(params);
      case "SET_BACKGROUND":
        return setBackground(params);
      case "GET_SLIDES_INFO":
        return getSlidesInfo();
      case "CLEAR_ALL":
        return clearAll();
      default:
        throw new Error(`Unknown command: ${type}`);
    }
  }
  function getSlides() {
    return figma.currentPage.children.filter(
      (n) => n.type === "FRAME"
    );
  }
  function getSlide(index) {
    const slides = getSlides();
    const slide = slides[index];
    if (!slide) throw new Error(`Slide ${index} not found (${slides.length} total)`);
    return slide;
  }
  function hexToRgb(hex) {
    const clean = hex.replace("#", "").padEnd(6, "0");
    return {
      r: parseInt(clean.slice(0, 2), 16) / 255,
      g: parseInt(clean.slice(2, 4), 16) / 255,
      b: parseInt(clean.slice(4, 6), 16) / 255
    };
  }
  async function loadFont(style) {
    try {
      await figma.loadFontAsync({ family: "Inter", style });
    } catch (e) {
      await figma.loadFontAsync({ family: "Roboto", style: "Regular" });
    }
  }
  async function createSlide(params) {
    var _a, _b;
    await loadFont("Regular");
    await loadFont("Bold");
    const frame = figma.createFrame();
    const existingCount = getSlides().length;
    frame.name = (_a = params.title) != null ? _a : `Slide ${existingCount + 1}`;
    frame.resize(SLIDE_W, SLIDE_H);
    frame.x = existingCount * (SLIDE_W + 120);
    frame.y = 0;
    frame.clipsContent = true;
    const bg = (_b = params.backgroundColor) != null ? _b : "#FFFFFF";
    const { r, g, b } = hexToRgb(bg);
    frame.fills = [{ type: "SOLID", color: { r, g, b } }];
    figma.currentPage.appendChild(frame);
    figma.viewport.scrollAndZoomIntoView([frame]);
    return { nodeId: frame.id, slideIndex: getSlides().length - 1 };
  }
  async function addText(params) {
    var _a, _b;
    const slide = getSlide(params.slideIndex);
    const style = (_a = params.fontWeight) != null ? _a : "Regular";
    await loadFont(style);
    const node = figma.createText();
    try {
      node.fontName = { family: "Inter", style };
    } catch (e) {
      node.fontName = { family: "Roboto", style: "Regular" };
    }
    node.fontSize = (_b = params.fontSize) != null ? _b : 24;
    node.textAutoResize = "NONE";
    node.resize(params.width, params.height);
    node.x = params.x;
    node.y = params.y;
    if (params.textAlign) {
      node.textAlignHorizontal = params.textAlign;
    }
    if (params.color) {
      const { r, g, b } = hexToRgb(params.color);
      node.fills = [{ type: "SOLID", color: { r, g, b } }];
    }
    node.characters = params.text;
    slide.appendChild(node);
    return { nodeId: node.id };
  }
  async function addShape(params) {
    const slide = getSlide(params.slideIndex);
    const node = params.shape === "ellipse" ? figma.createEllipse() : figma.createRectangle();
    node.resize(params.width, params.height);
    node.x = params.x;
    node.y = params.y;
    if (params.color) {
      const { r, g, b } = hexToRgb(params.color);
      node.fills = [{ type: "SOLID", color: { r, g, b } }];
    }
    if (params.opacity !== void 0) {
      node.opacity = Math.max(0, Math.min(1, params.opacity));
    }
    if (params.cornerRadius !== void 0 && node.type === "RECTANGLE") {
      node.cornerRadius = params.cornerRadius;
    }
    slide.appendChild(node);
    return { nodeId: node.id };
  }
  async function setBackground(params) {
    const slide = getSlide(params.slideIndex);
    const { r, g, b } = hexToRgb(params.color);
    slide.fills = [{ type: "SOLID", color: { r, g, b } }];
  }
  function getSlidesInfo() {
    const slides = getSlides().map((n, i) => ({
      index: i,
      nodeId: n.id,
      name: n.name
    }));
    return { slides };
  }
  function clearAll() {
    const nodes = [...figma.currentPage.children];
    nodes.forEach((n) => n.remove());
    return { removed: nodes.length };
  }
})();
