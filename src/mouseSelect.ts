import pc from "picocolors";
import stringWidth from "string-width";

export interface Choice<T> {
  name: string;
  value: T;
  description?: string;
  disabled?: boolean;
}

export class Separator {
  readonly isSeparator = true;
  constructor(readonly text: string = "───────────────────────────────────────────────────") {}
}

export interface MouseSelectOptions<T> {
  bannerLines?: string[];
  headerLines?: string[];
  message: string;
  choices: Array<Choice<T> | Separator>; // Scrollable list (projects/sessions)
  fixedChoices?: Array<Choice<T> | Separator>; // Fixed at the bottom (actions)
  pageSize?: number | "auto";
  initialIndex?: number;
}

let mouseTrackingActive = false;

/**
 * Enable VT SGR Mouse Tracking
 */
export function enableMouseTracking(): void {
  if (!mouseTrackingActive) {
    try {
      process.stdout.write("\x1b[?1000h\x1b[?1006h");
      mouseTrackingActive = true;
    } catch {}
  }
}

/**
 * Disable VT SGR Mouse Tracking
 */
export function disableMouseTracking(): void {
  try {
    process.stdout.write("\x1b[?1006l\x1b[?1000l\x1b[?25h");
    mouseTrackingActive = false;
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  } catch {}
}

// Global safety cleanup on exit
let globalCleanupRegistered = false;
function ensureGlobalCleanup(): void {
  if (globalCleanupRegistered) return;
  globalCleanupRegistered = true;
  const cleanup = () => disableMouseTracking();
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
}

/**
 * Pad a string on the right so its visible width matches targetWidth
 */
function padToWidth(str: string, targetWidth: number): string {
  const w = stringWidth(str);
  if (w >= targetWidth) {
    return str;
  }
  return str + " ".repeat(targetWidth - w);
}

/**
 * Center a string within targetWidth
 */
function centerString(str: string, targetWidth: number): string {
  const w = stringWidth(str);
  if (w >= targetWidth) return str;
  const left = Math.floor((targetWidth - w) / 2);
  const right = targetWidth - w - left;
  return " ".repeat(left) + str + " ".repeat(right);
}

/**
 * Interactive mouse-enabled terminal select prompt with centered Card layout
 * Supports scrollable choices + permanently fixed bottom choices
 */
export async function mouseSelect<T>(options: MouseSelectOptions<T>): Promise<T | null> {
  const {
    bannerLines = [],
    headerLines = [],
    message,
    choices,
    fixedChoices = [],
    pageSize = "auto",
    initialIndex = 0,
  } = options;

  const scrollableChoices = choices;
  const fixedList = fixedChoices;
  const allChoices: Array<Choice<T> | Separator> = [...scrollableChoices, ...fixedList];

  if (allChoices.length === 0) {
    return null;
  }

  ensureGlobalCleanup();

  // Find selectable choices and their global indices in allChoices
  const selectableIndices: number[] = [];
  allChoices.forEach((c, idx) => {
    if (!("isSeparator" in c) && !c.disabled) {
      selectableIndices.push(idx);
    }
  });

  if (selectableIndices.length === 0) {
    return null;
  }

  let activeSelectablePtr = 0;
  if (initialIndex > 0) {
    const found = selectableIndices.indexOf(initialIndex);
    if (found !== -1) {
      activeSelectablePtr = found;
    }
  }

  let isDone = false;
  let selectedValue: T | null = null;
  const promptStartTime = Date.now();
  let scrollWindowStart = 0;

  // Hide cursor and enable mouse tracking
  process.stdout.write("\x1b[?25l");
  enableMouseTracking();

  const stdin = process.stdin;
  if (stdin.setRawMode) {
    stdin.setRawMode(true);
  }
  stdin.resume();

  const getActiveChoiceIndex = () => selectableIndices[activeSelectablePtr];
  const rowToChoiceMap = new Map<number, number>();

  /**
   * Render the menu in centered card layout starting at Row 1
   * Height automatically adapts to terminal window rows
   */
  function render(): void {
    const activeGlobalIdx = getActiveChoiceIndex();
    rowToChoiceMap.clear();

    const termCols = process.stdout.columns || 80;
    const termRows = process.stdout.rows || 24;

    const cardWidth = Math.min(Math.max(termCols - 4, 60), 82);
    const innerWidth = cardWidth - 4; // 2 cols for "│ ", 2 cols for " │"
    const leftPadCount = Math.max(0, Math.floor((termCols - cardWidth) / 2));
    const padStr = " ".repeat(leftPadCount);

    // Calculate vertical space occupied by non-scrollable UI elements
    const topBannerRows = bannerLines.length > 0 ? bannerLines.length + 2 : 1;
    const cardTopBorderRows = 1;
    const headerRows = headerLines.length > 0 ? headerLines.length + 1 : 0; // lines + 1 divider
    const promptRows = 2; // prompt line + sub-separator
    const fixedAreaRows = fixedList.length > 0 ? fixedList.length + 1 : 0; // 1 divider + items
    const hasAnyDescription = allChoices.some(
      (c) => !("isSeparator" in c) && Boolean(c.description)
    );
    const descDrawerRows = hasAnyDescription ? 2 : 0; // 1 divider + 1 desc line
    const cardBottomBorderRows = 1;
    const footerHintRows = 1;
    const scrollIndicatorsRows = 2; // reserved rows for ↑ / ↓ scroll indicator tips
    const safetyBuffer = 2; // buffer to avoid terminal buffer scroll

    const totalOverhead =
      topBannerRows +
      cardTopBorderRows +
      headerRows +
      promptRows +
      fixedAreaRows +
      descDrawerRows +
      cardBottomBorderRows +
      footerHintRows +
      scrollIndicatorsRows +
      safetyBuffer;

    // Calculate effectivePageSize: dynamically expand to fill terminal height
    let effectivePageSize: number;
    if (pageSize === "auto" || typeof pageSize !== "number" || pageSize <= 0) {
      effectivePageSize = Math.max(3, termRows - totalOverhead);
    } else {
      effectivePageSize = Math.max(3, Math.min(pageSize, termRows - totalOverhead));
    }

    // Calculate pagination window ONLY for scrollableChoices
    let scrollWindowEnd = scrollableChoices.length;

    if (scrollableChoices.length > effectivePageSize) {
      if (activeGlobalIdx < scrollableChoices.length) {
        // Active item is inside scrollable choices: keep it visible
        if (activeGlobalIdx < scrollWindowStart) {
          scrollWindowStart = activeGlobalIdx;
        } else if (activeGlobalIdx >= scrollWindowStart + effectivePageSize) {
          scrollWindowStart = activeGlobalIdx - effectivePageSize + 1;
        }
      }
      // Clamping: ensure scrollWindowStart doesn't overshoot if window expanded
      if (scrollWindowStart + effectivePageSize > scrollableChoices.length) {
        scrollWindowStart = Math.max(0, scrollableChoices.length - effectivePageSize);
      }
      scrollWindowEnd = Math.min(scrollableChoices.length, scrollWindowStart + effectivePageSize);
    } else {
      scrollWindowStart = 0;
      scrollWindowEnd = scrollableChoices.length;
    }

    const lines: string[] = [];
    let currentScreenRow = 1;

    // 1. Render Top Banner (if provided)
    if (bannerLines.length > 0) {
      lines.push("");
      currentScreenRow++;
      for (const b of bannerLines) {
        lines.push(centerString(b, termCols));
        currentScreenRow++;
      }
      lines.push("");
      currentScreenRow++;
    } else {
      lines.push("");
      currentScreenRow++;
    }

    // 2. Card Top Border: ╭────────────────────────────╮
    lines.push(padStr + pc.cyan("╭" + "─".repeat(cardWidth - 2) + "╮"));
    currentScreenRow++;

    // 3. Header Lines inside Card (e.g. Project details)
    if (headerLines.length > 0) {
      for (const h of headerLines) {
        const paddedHeader = padToWidth(h, innerWidth);
        lines.push(padStr + pc.cyan("│ ") + paddedHeader + pc.cyan(" │"));
        currentScreenRow++;
      }
      // Divider after header
      lines.push(padStr + pc.cyan("├" + "─".repeat(cardWidth - 2) + "┤"));
      currentScreenRow++;
    }

    // 4. Prompt message line
    const promptLine = `${pc.cyan("? ")}${pc.bold(message)}`;
    lines.push(padStr + pc.cyan("│ ") + padToWidth(promptLine, innerWidth) + pc.cyan(" │"));
    currentScreenRow++;

    // Sub-separator under prompt message
    lines.push(padStr + pc.cyan("│ ") + padToWidth(pc.gray("┄".repeat(innerWidth)), innerWidth) + pc.cyan(" │"));
    currentScreenRow++;

    // 5. Scrollable Area (Projects / Tasks / Sessions)
    if (scrollableChoices.length > 0) {
      // Top scroll indicator if items above
      if (scrollWindowStart > 0) {
        const topScroll = pc.yellow(`  ↑ ... (向上滑动滚轮查看更多)`);
        lines.push(padStr + pc.cyan("│ ") + padToWidth(topScroll, innerWidth) + pc.cyan(" │"));
        currentScreenRow++;
      }

      // Render visible scrollable choices
      for (let i = scrollWindowStart; i < scrollWindowEnd; i++) {
        const item = scrollableChoices[i];

        if ("isSeparator" in item) {
          const sepContent = pc.gray("─".repeat(innerWidth));
          lines.push(padStr + pc.cyan("│ ") + padToWidth(sepContent, innerWidth) + pc.cyan(" │"));
        } else if (item.disabled) {
          const disContent = pc.gray(`   - ${item.name} (不可用)`);
          lines.push(padStr + pc.cyan("│ ") + padToWidth(disContent, innerWidth) + pc.cyan(" │"));
        } else {
          const isSelected = i === activeGlobalIdx;
          const prefix = isSelected ? pc.cyan("❯ ") : "  ";
          const textFormatted = isSelected ? pc.cyan(pc.bold(item.name)) : item.name;
          const fullContent = `${prefix}${textFormatted}`;

          lines.push(padStr + pc.cyan("│ ") + padToWidth(fullContent, innerWidth) + pc.cyan(" │"));
          rowToChoiceMap.set(currentScreenRow, i);
        }
        currentScreenRow++;
      }

      // Bottom scroll indicator if items below
      if (scrollWindowEnd < scrollableChoices.length) {
        const botScroll = pc.yellow(`  ↓ ... (向下滑动滚轮查看更多)`);
        lines.push(padStr + pc.cyan("│ ") + padToWidth(botScroll, innerWidth) + pc.cyan(" │"));
        currentScreenRow++;
      }
    }

    // 6. Fixed Bottom Area (Always visible, never scrolled out!)
    if (fixedList.length > 0) {
      lines.push(padStr + pc.cyan("├" + "─".repeat(cardWidth - 2) + "┤"));
      currentScreenRow++;

      for (let j = 0; j < fixedList.length; j++) {
        const globalIdx = scrollableChoices.length + j;
        const item = fixedList[j];

        if ("isSeparator" in item) {
          const sepContent = pc.gray("─".repeat(innerWidth));
          lines.push(padStr + pc.cyan("│ ") + padToWidth(sepContent, innerWidth) + pc.cyan(" │"));
        } else if (item.disabled) {
          const disContent = pc.gray(`   - ${item.name} (不可用)`);
          lines.push(padStr + pc.cyan("│ ") + padToWidth(disContent, innerWidth) + pc.cyan(" │"));
        } else {
          const isSelected = globalIdx === activeGlobalIdx;
          const prefix = isSelected ? pc.cyan("❯ ") : "  ";
          const textFormatted = isSelected ? pc.cyan(pc.bold(item.name)) : item.name;
          const fullContent = `${prefix}${textFormatted}`;

          lines.push(padStr + pc.cyan("│ ") + padToWidth(fullContent, innerWidth) + pc.cyan(" │"));
          rowToChoiceMap.set(currentScreenRow, globalIdx);
        }
        currentScreenRow++;
      }
    }

    // 7. Description Drawer at bottom of card (for whichever item is currently active)
    const activeItem = allChoices[activeGlobalIdx];
    if (activeItem && !("isSeparator" in activeItem) && activeItem.description) {
      lines.push(padStr + pc.cyan("├" + "─".repeat(cardWidth - 2) + "┤"));
      currentScreenRow++;
      const descLine = pc.gray(`↳ ${activeItem.description}`);
      lines.push(padStr + pc.cyan("│ ") + padToWidth(descLine, innerWidth) + pc.cyan(" │"));
      currentScreenRow++;
    }

    // 8. Card Bottom Border: ╰────────────────────────────╯
    lines.push(padStr + pc.cyan("╰" + "─".repeat(cardWidth - 2) + "╯"));
    currentScreenRow++;

    // 9. Centered Footer Hints below card
    const hintText = pc.gray("[ 🖱️ 滚轮滑动 · 单击直接进入 ]     [ ⌨️ ↑↓移动 · Enter确认 · Esc/q返回 ]");
    lines.push(centerString(hintText, termCols));

    // Clear whole screen and draw from Row 1
    process.stdout.write("\x1b[H\x1b[2J" + lines.join("\n") + "\n");
  }

  /**
   * Navigation methods with STRICT clamping (NO wrapping/looping)
   */
  function moveUp(): void {
    if (activeSelectablePtr > 0) {
      activeSelectablePtr--;
      render();
    }
  }

  function moveDown(): void {
    if (activeSelectablePtr < selectableIndices.length - 1) {
      activeSelectablePtr++;
      render();
    }
  }

  function confirmActive(): void {
    const activeIdx = getActiveChoiceIndex();
    const item = allChoices[activeIdx];
    if (item && !("isSeparator" in item) && !item.disabled) {
      selectedValue = item.value;
      isDone = true;
    }
  }

  function confirmChoiceIndex(idx: number): void {
    const item = allChoices[idx];
    if (item && !("isSeparator" in item) && !item.disabled) {
      const ptr = selectableIndices.indexOf(idx);
      if (ptr !== -1) {
        activeSelectablePtr = ptr;
      }
      selectedValue = item.value;
      isDone = true;
    }
  }

  // Handle window resize event smoothly
  const onResize = () => render();
  process.stdout.on("resize", onResize);

  // Initial render
  render();

  return new Promise<T | null>((resolve) => {
    function finish(val: T | null): void {
      process.stdout.removeListener("resize", onResize);
      stdin.removeListener("data", onData);
      process.stdout.write("\x1b[?25h");
      resolve(val);
    }

    function onData(chunk: Buffer): void {
      const str = chunk.toString("utf8");

      // 1. Parse SGR Mouse sequences: \x1b[<{btn};{x};{y}[M|m]
      const mouseRegex = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
      let m: RegExpExecArray | null;
      let handledMouse = false;

      while ((m = mouseRegex.exec(str)) !== null) {
        handledMouse = true;
        const button = parseInt(m[1], 10);
        const mouseY = parseInt(m[3], 10);
        const flag = m[4]; // 'M' = press, 'm' = release

        // Debounce: ignore residual events within first 80ms
        if (Date.now() - promptStartTime < 80) {
          continue;
        }

        // Mouse Wheel UP -> Code 64 (Strictly clamped at top)
        if (button === 64) {
          moveUp();
          continue;
        }

        // Mouse Wheel DOWN -> Code 65 (Strictly clamped at bottom)
        if (button === 65) {
          moveDown();
          continue;
        }

        // Left Click PRESS -> Code 0, flag 'M'
        if (button === 0 && flag === "M") {
          if (rowToChoiceMap.has(mouseY)) {
            const clickedChoiceIdx = rowToChoiceMap.get(mouseY)!;
            confirmChoiceIndex(clickedChoiceIdx);
            if (isDone) {
              finish(selectedValue);
              return;
            }
          }
        }
      }

      if (handledMouse) {
        return;
      }

      // 2. Handle Keyboard events
      // Ctrl+C (\x03)
      if (str === "\x03") {
        disableMouseTracking();
        finish(null);
        process.exit(0);
      }

      // Escape (\x1b) or q/Q
      if (str === "\x1b" || str === "q" || str === "Q") {
        finish(null);
        return;
      }

      // Enter (\r or \n)
      if (str === "\r" || str === "\n") {
        confirmActive();
        if (isDone) {
          finish(selectedValue);
          return;
        }
      }

      // Arrow UP (\x1b[A or \x1bOA or 'k')
      if (str === "\x1b[A" || str === "\x1bOA" || str === "k") {
        moveUp();
        return;
      }

      // Arrow DOWN (\x1b[B or \x1bOB or 'j')
      if (str === "\x1b[B" || str === "\x1bOB" || str === "j") {
        moveDown();
        return;
      }

      // Page Up (\x1b[5~)
      if (str === "\x1b[5~") {
        for (let i = 0; i < 5; i++) moveUp();
        return;
      }

      // Page Down (\x1b[6~)
      if (str === "\x1b[6~") {
        for (let i = 0; i < 5; i++) moveDown();
        return;
      }

      // Home key (\x1b[H or \x1b[1~) -> jump to top
      if (str === "\x1b[H" || str === "\x1b[1~") {
        activeSelectablePtr = 0;
        render();
        return;
      }

      // End key (\x1b[F or \x1b[4~) -> jump to bottom
      if (str === "\x1b[F" || str === "\x1b[4~") {
        activeSelectablePtr = selectableIndices.length - 1;
        render();
        return;
      }
    }

    stdin.on("data", onData);
  });
}
