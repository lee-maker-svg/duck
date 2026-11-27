const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/deeplab_v3/float32/1/deeplab_v3.tflite';
const OUTPUT_WIDTH = 640;

const video = document.querySelector('#webcam');
const stage = document.querySelector('#stage');
const output = document.querySelector('#person-layer');
const outputContext = output.getContext('2d', { alpha: true });
const sceneImage = document.querySelector('#scene-image');
const cameraButton = document.querySelector('#camera-button');
const cameraButtonLabel = document.querySelector('#camera-button-label');
const captureButton = document.querySelector('#capture-button');
const placeholderStart = document.querySelector('#placeholder-start');
const placeholder = document.querySelector('#stage-placeholder');
const cameraStatus = document.querySelector('#camera-status');
const livePill = document.querySelector('#live-pill');
const backgroundInput = document.querySelector('#background-input');
const toast = document.querySelector('#toast');

const frameCanvas = document.createElement('canvas');
const frameContext = frameCanvas.getContext('2d', { willReadFrequently: true });
const cutoutCanvas = document.createElement('canvas');
const cutoutContext = cutoutCanvas.getContext('2d');
const maskCanvas = document.createElement('canvas');
const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true });

let segmenter = null;
let segmenterPromise = null;
let cameraStream = null;
let animationFrame = 0;
let lastVideoTime = -1;
let segmenting = false;
let isCameraOn = false;
let hasPersonFrame = false;
let cameraEpoch = 0;
let personLabel = 15;
let activeBackgroundUrl = null;
let toastTimer = 0;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3400);
}

function setStatus(message) {
  if (cameraStatus.textContent !== message) cameraStatus.textContent = message;
}

function setCameraUi(connected) {
  isCameraOn = connected;
  cameraButtonLabel.textContent = connected ? '카메라 끄기' : '카메라 켜기';
  captureButton.disabled = !connected || !hasPersonFrame;
  placeholder.classList.toggle('is-hidden', connected);
  livePill.classList.toggle('is-live', connected);
  livePill.innerHTML = connected ? '<i></i> LIVE' : '<i></i> STANDBY';
}

async function loadSegmenter() {
  if (segmenter) return segmenter;
  if (segmenterPromise) return segmenterPromise;

  segmenterPromise = (async () => {
    setStatus('사람 인식 모델을 불러오는 중이에요…');
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    const options = {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    };

    try {
      segmenter = await ImageSegmenter.createFromOptions(vision, options);
    } catch (gpuError) {
      console.info('GPU delegate unavailable; retrying with CPU.', gpuError);
      segmenter = await ImageSegmenter.createFromOptions(vision, {
        ...options,
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
      });
    }

    const labels = segmenter.getLabels?.() ?? [];
    const detectedPersonLabel = labels.findIndex((label) => /person/i.test(label));
    if (detectedPersonLabel >= 0) personLabel = detectedPersonLabel;
    return segmenter;
  })();

  try {
    return await segmenterPromise;
  } catch (error) {
    segmenterPromise = null;
    throw error;
  }
}

function prepareCanvases() {
  const ratio = stage.clientWidth / stage.clientHeight || 4 / 3;
  const width = Math.min(OUTPUT_WIDTH, video.videoWidth || OUTPUT_WIDTH);
  const height = Math.round(width / ratio);
  for (const canvas of [output, frameCanvas, cutoutCanvas]) {
    canvas.width = width;
    canvas.height = height;
  }
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = 'high';
  frameContext.imageSmoothingEnabled = true;
  frameContext.imageSmoothingQuality = 'high';
}

function drawMask(categoryMask) {
  const width = categoryMask.width;
  const height = categoryMask.height;
  const categories = categoryMask.getAsUint8Array();
  if (!width || !height || categories.length !== width * height) return false;

  if (maskCanvas.width !== width || maskCanvas.height !== height) {
    maskCanvas.width = width;
    maskCanvas.height = height;
  }
  const maskImage = maskContext.createImageData(width, height);
  for (let source = 0, target = 0; source < categories.length; source += 1, target += 4) {
    const isPerson = categories[source] === personLabel;
    maskImage.data[target] = 255;
    maskImage.data[target + 1] = 255;
    maskImage.data[target + 2] = 255;
    maskImage.data[target + 3] = isPerson ? 255 : 0;
  }
  maskContext.putImageData(maskImage, 0, 0);

  cutoutContext.clearRect(0, 0, cutoutCanvas.width, cutoutCanvas.height);
  cutoutContext.globalCompositeOperation = 'source-over';
  cutoutContext.drawImage(frameCanvas, 0, 0, cutoutCanvas.width, cutoutCanvas.height);
  cutoutContext.globalCompositeOperation = 'destination-in';
  const inputAspect = video.videoWidth / video.videoHeight;
  const outputAspect = cutoutCanvas.width / cutoutCanvas.height;
  let maskWidth = maskCanvas.width;
  let maskHeight = maskCanvas.height;
  if (inputAspect > outputAspect) maskWidth *= outputAspect / inputAspect;
  else maskHeight *= inputAspect / outputAspect;
  cutoutContext.drawImage(
    maskCanvas,
    (maskCanvas.width - maskWidth) / 2,
    (maskCanvas.height - maskHeight) / 2,
    maskWidth,
    maskHeight,
    0,
    0,
    cutoutCanvas.width,
    cutoutCanvas.height,
  );
  cutoutContext.globalCompositeOperation = 'source-over';

  outputContext.clearRect(0, 0, output.width, output.height);
  outputContext.drawImage(cutoutCanvas, 0, 0);
  return true;
}

function onSegmentationResult(result, epoch) {
  try {
    if (epoch === cameraEpoch && isCameraOn && result.categoryMask && drawMask(result.categoryMask)) {
      hasPersonFrame = true;
      captureButton.disabled = false;
      setStatus('좋아요! 거위들 사이에 잘 들어왔어요.');
    }
  } catch (error) {
    console.error('Could not draw the person mask.', error);
    setStatus('영상을 합성하는 중 문제가 생겼어요. 카메라를 다시 켜 주세요.');
  } finally {
    result.categoryMask?.close?.();
    segmenting = false;
  }
}

function renderLoop() {
  animationFrame = window.requestAnimationFrame(renderLoop);
  if (!segmenter || !isCameraOn || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  if (segmenting || video.currentTime === lastVideoTime) return;

  lastVideoTime = video.currentTime;
  drawCover(frameContext, video, 0, 0, frameCanvas.width, frameCanvas.height);
  segmenting = true;
  const epoch = cameraEpoch;
  try {
    segmenter.segmentForVideo(video, performance.now(), (result) => onSegmentationResult(result, epoch));
  } catch (error) {
    segmenting = false;
    console.error('Frame segmentation failed.', error);
  }
}

async function enableCamera() {
  if (isCameraOn) return;
  if (window.location.protocol === 'file:') {
    const message = 'file://로 열면 MediaPipe 모듈이 실행되지 않아요. localhost로 열어 주세요.';
    setStatus(message);
    showToast(message);
    return;
  }
  if (!window.isSecureContext) {
    const message = '카메라는 HTTPS 또는 localhost에서 열어야 사용할 수 있어요.';
    setStatus(message);
    showToast(message);
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('카메라는 HTTPS 또는 localhost에서 열어야 사용할 수 있어요.');
    setStatus('보안 연결에서 페이지를 열어 주세요.');
    return;
  }

  cameraButton.disabled = true;
  placeholderStart.disabled = true;
  setStatus('카메라와 사람 인식 기능을 준비하고 있어요…');
  const streamPromise = navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  try {
    const [stream] = await Promise.all([
      streamPromise,
      loadSegmenter(),
    ]);
    cameraStream = stream;
    video.srcObject = stream;
    await video.play();
    if (video.videoWidth) prepareCanvases();
    else await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }));
    prepareCanvases();
    lastVideoTime = -1;
    hasPersonFrame = false;
    setCameraUi(true);
    setStatus('사람 인식이 켜졌어요. 화면 중앙에 서 보세요.');
    animationFrame = window.requestAnimationFrame(renderLoop);
  } catch (error) {
    streamPromise.then((stream) => stream.getTracks().forEach((track) => track.stop()), () => {});
    console.error('Camera startup failed.', error);
    const message = error.name === 'NotAllowedError'
      ? '브라우저 주소창에서 카메라 권한을 허용해 주세요.'
      : error.name === 'NotFoundError'
        ? '사용할 수 있는 카메라를 찾지 못했어요.'
          : /import|fetch|network|load/i.test(error.message ?? '')
            ? 'MediaPipe 모델을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'
            : '카메라 또는 모델을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
    setStatus(message);
    showToast(message);
    if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  } finally {
    cameraButton.disabled = false;
    placeholderStart.disabled = false;
  }
}

function disableCamera() {
  cameraEpoch += 1;
  window.cancelAnimationFrame(animationFrame);
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  video.srcObject = null;
  outputContext.clearRect(0, 0, output.width, output.height);
  hasPersonFrame = false;
  setCameraUi(false);
  setStatus('준비되면 카메라를 켜 주세요.');
}

function drawCover(context, image, x, y, width, height) {
  const sourceWidth = image.videoWidth || image.naturalWidth || image.width;
  const sourceHeight = image.videoHeight || image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) return;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const cropWidth = width / scale;
  const cropHeight = height / scale;
  const sourceX = (sourceWidth - cropWidth) / 2;
  const sourceY = (sourceHeight - cropHeight) / 2;
  context.drawImage(image, sourceX, sourceY, cropWidth, cropHeight, x, y, width, height);
}

async function savePhoto() {
  if (!isCameraOn || !output.width) return;
  const width = 1200;
  const height = 900;
  const photo = document.createElement('canvas');
  photo.width = width;
  photo.height = height;
  const context = photo.getContext('2d');
  drawCover(context, sceneImage, 0, 0, width, height);
  context.save();
  context.translate(width, 0);
  context.scale(-1, 1);
  drawCover(context, output, 0, 0, width, height);
  context.restore();

  const blob = await new Promise((resolve) => photo.toBlob(resolve, 'image/png'));
  if (!blob) {
    showToast('사진을 저장하지 못했어요. 한 번 더 눌러 주세요.');
    return;
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `goose-cam-${new Date().toISOString().slice(0, 10)}.png`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  showToast('찰칵! 사진을 저장했어요.');
}

function changeBackground(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('GIF, JPG, PNG 이미지 파일을 선택해 주세요.');
    return;
  }
  if (activeBackgroundUrl) URL.revokeObjectURL(activeBackgroundUrl);
  activeBackgroundUrl = URL.createObjectURL(file);
  sceneImage.src = activeBackgroundUrl;
  document.querySelector('.scene-preview-wrap img').src = activeBackgroundUrl;
  document.querySelector('#scene-title').textContent = file.name.replace(/\.[^.]+$/, '').slice(0, 22);
  document.querySelector('#scene-description').innerHTML = '내가 고른 장면으로<br />새로운 사진을 찍어 보세요.';
  showToast('새 배경을 불러왔어요.');
}

cameraButton.addEventListener('click', () => (isCameraOn ? disableCamera() : enableCamera()));
placeholderStart.addEventListener('click', enableCamera);
captureButton.addEventListener('click', savePhoto);
backgroundInput.addEventListener('change', (event) => {
  changeBackground(event.target.files?.[0]);
  event.target.value = '';
});

window.addEventListener('pagehide', () => {
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  if (activeBackgroundUrl) URL.revokeObjectURL(activeBackgroundUrl);
  segmenter?.close?.();
});

sceneImage.addEventListener('error', () => {
  setStatus('배경을 읽을 수 없어요. 다른 이미지 파일을 선택해 주세요.');
});
