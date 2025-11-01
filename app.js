const initialLayout = [
  [
    { value: 8, locked: true },
    { value: null, locked: false },
    { value: 6, locked: true }
  ],
  [
    { value: null, locked: false },
    { value: 5, locked: true },
    { value: null, locked: false }
  ],
  [
    { value: 4, locked: true },
    { value: null, locked: false },
    { value: null, locked: false }
  ]
];

const boardElement = document.querySelector('.board');
const statusMessage = document.getElementById('statusMessage');
const checkButton = document.getElementById('checkButton');
const resetButton = document.getElementById('resetButton');

const cellState = [];
let modelPromise = null;

const MODEL_URL = 'https://storage.googleapis.com/learnjs-data/model-builder/mnist.json';

function ensureModelLoaded() {
  if (!modelPromise) {
    modelPromise = tf.loadLayersModel(MODEL_URL);
  }
  return modelPromise;
}

function createBoard() {
  boardElement.innerHTML = '';
  cellState.length = 0;

  initialLayout.forEach((rowConfig, rowIndex) => {
    const rowState = [];
    rowConfig.forEach((cellConfig, colIndex) => {
      const cellElement = document.createElement('div');
      cellElement.classList.add('cell');
      cellElement.setAttribute('role', 'gridcell');
      cellElement.dataset.row = String(rowIndex);
      cellElement.dataset.col = String(colIndex);

      if (cellConfig.locked) {
        cellElement.classList.add('hint');
        cellElement.textContent = String(cellConfig.value);
        rowState.push({ element: cellElement, locked: true, value: cellConfig.value });
      } else {
        const canvas = document.createElement('canvas');
        const controls = document.createElement('div');
        controls.classList.add('cell-controls');

        const recognizedValue = document.createElement('span');
        recognizedValue.classList.add('recognized-value');
        recognizedValue.textContent = '？';
        recognizedValue.setAttribute('aria-live', 'polite');

        const manualInput = document.createElement('div');
        manualInput.classList.add('manual-input');

        const input = document.createElement('input');
        input.type = 'number';
        input.inputMode = 'numeric';
        input.min = '1';
        input.max = '9';
        input.pattern = '[1-9]';
        input.placeholder = '1-9';
        input.setAttribute('aria-label', '数字を直接入力');

        const clearButton = document.createElement('button');
        clearButton.type = 'button';
        clearButton.textContent = 'クリア';
        clearButton.setAttribute('aria-label', 'このマスをクリア');

        manualInput.append(input, clearButton);
        controls.append(recognizedValue, manualInput);
        cellElement.append(canvas, controls);

        const cellInfo = {
          element: cellElement,
          locked: false,
          value: null,
          canvas,
          recognizedValue,
          input,
          clearButton,
          hasDrawing: false
        };

        setupCanvas(cellInfo);
        setupManualInput(cellInfo);
        rowState.push(cellInfo);
      }

      boardElement.appendChild(cellElement);
    });
    cellState.push(rowState);
  });
}

function setupCanvas(cellInfo) {
  const { canvas } = cellInfo;
  const ctx = canvas.getContext('2d');
  cellInfo.context = ctx;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width === rect.width * dpr && canvas.height === rect.height * dpr) {
      return;
    }
    let dataUrl = null;
    if (canvas.width && canvas.height) {
      dataUrl = canvas.toDataURL();
    }
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(rect.width, rect.height) / 12;
    ctx.strokeStyle = '#1f2937';
    fillCanvasWhite(ctx, canvas);
    if (dataUrl) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
      };
      img.src = dataUrl;
    }
  };

  resize();
  window.addEventListener('resize', () => resize(), { passive: true });

  let drawing = false;

  const getCanvasPoint = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  };

  const scheduleRecognition = debounce(() => recognizeDigit(cellInfo), 300);

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drawing = true;
    const { x, y } = getCanvasPoint(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y);
    ctx.stroke();
    cellInfo.hasDrawing = true;
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    const { x, y } = getCanvasPoint(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  });

  const finishStroke = (event) => {
    if (!drawing) return;
    drawing = false;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    ctx.closePath();
    scheduleRecognition();
  };

  canvas.addEventListener('pointerup', finishStroke);
  canvas.addEventListener('pointercancel', finishStroke);
  canvas.addEventListener('pointerleave', finishStroke);

  cellInfo.clearButton.addEventListener('click', () => clearCell(cellInfo));
}

function setupManualInput(cellInfo) {
  const { input } = cellInfo;
  const handleManual = () => {
    const parsed = Number.parseInt(input.value, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 9) {
      setCellValue(cellInfo, parsed, 'manual');
    } else {
      if (input.value !== '') {
        input.value = '';
      }
      setCellValue(cellInfo, null, 'manual');
    }
  };

  input.addEventListener('input', handleManual);
  input.addEventListener('change', handleManual);

  input.addEventListener('focus', () => {
    statusMessage.textContent = '';
    statusMessage.classList.remove('error');
  });
}

function fillCanvasWhite(ctx, canvas) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function clearCell(cellInfo) {
  const { context, canvas, input } = cellInfo;
  fillCanvasWhite(context, canvas);
  cellInfo.hasDrawing = false;
  if (input) {
    input.value = '';
  }
  setCellValue(cellInfo, null, 'clear');
}

function setCellValue(cellInfo, value, source = 'auto', confidence = null) {
  cellInfo.value = value;
  if (cellInfo.recognizedValue) {
    if (value === null || Number.isNaN(value)) {
      cellInfo.recognizedValue.textContent = '？';
      cellInfo.recognizedValue.title = '';
    } else {
      cellInfo.recognizedValue.textContent = String(value);
      cellInfo.recognizedValue.title = confidence ? `信頼度 ${(confidence * 100).toFixed(0)}% (${source})` : `${source === 'manual' ? '手入力' : '自動認識'}`;
    }
  }
}

async function recognizeDigit(cellInfo) {
  if (!cellInfo.hasDrawing) {
    return;
  }

  cellInfo.recognizedValue.textContent = '…';
  cellInfo.recognizedValue.title = '読み取り中';

  try {
    const model = await ensureModelLoaded();
    const tensor = canvasToTensor(cellInfo.canvas);
    const predictions = model.predict(tensor);
    const data = await predictions.data();
    predictions.dispose();
    tensor.dispose();

    let maxIndex = 0;
    let maxValue = data[0];
    for (let i = 1; i < data.length; i += 1) {
      if (data[i] > maxValue) {
        maxValue = data[i];
        maxIndex = i;
      }
    }

    const confidence = maxValue;
    if (confidence < 0.6) {
      setCellValue(cellInfo, null, 'auto', confidence);
      cellInfo.recognizedValue.textContent = '？';
      cellInfo.recognizedValue.title = '判別できませんでした';
      return;
    }

    const digit = maxIndex;
    if (digit === 0) {
      setCellValue(cellInfo, null, 'auto', confidence);
      cellInfo.recognizedValue.textContent = '？';
      cellInfo.recognizedValue.title = '0 は使用できません';
      return;
    }

    setCellValue(cellInfo, digit, 'auto', confidence);
    if (cellInfo.input) {
      cellInfo.input.value = String(digit);
    }
  } catch (error) {
    console.error('Recognition error:', error);
    cellInfo.recognizedValue.textContent = '×';
    cellInfo.recognizedValue.title = '認識エラーが発生しました';
  }
}

function canvasToTensor(canvas) {
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = 28;
  tmpCanvas.height = 28;
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.fillStyle = '#ffffff';
  tmpCtx.fillRect(0, 0, tmpCanvas.width, tmpCanvas.height);
  tmpCtx.drawImage(canvas, 0, 0, tmpCanvas.width, tmpCanvas.height);
  const { data } = tmpCtx.getImageData(0, 0, tmpCanvas.width, tmpCanvas.height);
  const buffer = new Float32Array(28 * 28);
  for (let i = 0; i < data.length; i += 4) {
    const grayscale = (data[i] + data[i + 1] + data[i + 2]) / 3;
    buffer[i / 4] = (255 - grayscale) / 255;
  }
  return tf.tensor4d(buffer, [1, 28, 28, 1]);
}

function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => fn(...args), delay);
  };
}

function collectValues() {
  return cellState.map((row) => row.map((cell) => cell.value));
}

function checkMagicSquare() {
  const values = collectValues();

  for (let r = 0; r < values.length; r += 1) {
    for (let c = 0; c < values[r].length; c += 1) {
      const cell = cellState[r][c];
      if (cell.locked) continue;
      if (cell.value === null || Number.isNaN(cell.value)) {
        showStatus('すべてのマスを埋めてください。', true);
        return;
      }
    }
  }

  const filledValues = values.flat().filter((value) => value !== null && !Number.isNaN(value));

  const usedNumbers = new Set(filledValues);
  if (filledValues.length !== usedNumbers.size) {
    showStatus('同じ数字は 1 度しか使えません。', true);
    return;
  }

  if (!values.every((row) => row.every((value) => Number.isInteger(value) && value >= 1 && value <= 9))) {
    showStatus('1〜9 の数字のみ使用できます。', true);
    return;
  }

  const target = 15;
  const rowsValid = values.every((row) => row.reduce((sum, v) => sum + v, 0) === target);
  const colsValid = [0, 1, 2].every((col) => values[0][col] + values[1][col] + values[2][col] === target);
  const diag1 = values[0][0] + values[1][1] + values[2][2] === target;
  const diag2 = values[0][2] + values[1][1] + values[2][0] === target;

  if (rowsValid && colsValid && diag1 && diag2) {
    showStatus('おめでとうございます！魔法陣の完成です ✨', false);
  } else {
    showStatus('まだ魔法陣になっていません。もう一度考えてみましょう。', true);
  }
}

function showStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle('error', isError);
}

function resetBoard() {
  cellState.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      if (cell.locked) return;
      clearCell(cell);
      const initialValue = initialLayout[rowIndex][colIndex].value;
      if (initialValue) {
        setCellValue(cell, initialValue, 'reset');
        if (cell.input) {
          cell.input.value = String(initialValue);
        }
      }
    });
  });
  showStatus('ボードをリセットしました。');
}

checkButton.addEventListener('click', checkMagicSquare);
resetButton.addEventListener('click', resetBoard);

createBoard();
showStatus('ヒントを活かして魔法陣を完成させましょう！');
