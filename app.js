const video = document.getElementById('video');
const statusText = document.getElementById('status-text');
const modeButtons = document.querySelectorAll('.mode-btn');
const analyzeBtn = document.getElementById('analyze-btn');
const imageUpload = document.getElementById('image-upload');
const resultCard = document.getElementById('result-card');
const resultTitle = document.getElementById('result-title');
const statsOutput = document.getElementById('stats-output');
const closeBtn = document.getElementById('close-result');
const strictnessButtons = document.querySelectorAll('.strictness-btn');
const dataStream = document.getElementById('data-stream');
const viewfinder = document.querySelector('.viewfinder');
const canvas = document.getElementById('overlay');
const meshToggle = document.getElementById('mesh-toggle');

let currentMode = 'chad';
let strictnessMode = 'lenient';
let isUsingCamera = false;
let isScanning = false;
let showMesh = false;
let modelsLoaded = false;

/**
 * VIEWPORT ANCHORING
 * Forces the app to the exact height of the visual viewport to prevent 
 * scrolling/layout bugs on mobile iFrames.
 */
function setRealHeight() {
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.querySelector('.app-container').style.height = `${vh}px`;
}

window.addEventListener('resize', setRealHeight);
if (window.visualViewport) window.visualViewport.addEventListener('resize', setRealHeight);
setRealHeight();

// UI State Management
meshToggle.addEventListener('click', () => {
    showMesh = !showMesh;
    meshToggle.classList.toggle('active', showMesh);
    meshToggle.textContent = showMesh ? "MESH: ON" : "MESH: OFF";
    if (!showMesh) clearMesh();
});

async function idleDetect() {
    if (isScanning || !isUsingCamera || video.paused || !modelsLoaded) return;
    const det = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions());
    if (det) {
        viewfinder.classList.add('locked');
        statusText.textContent = "TARGET LOCKED";
        if (showMesh) drawMesh(det);
        const centerX = ((det.box.x / video.videoWidth) * 100).toFixed(1);
        const centerY = ((det.box.y / video.videoHeight) * 100).toFixed(1);
        dataStream.textContent = `X:${centerX} Y:${centerY} Z:SYNC`;
    } else {
        viewfinder.classList.remove('locked');
        statusText.textContent = "SEARCHING...";
        const x = (Math.random() * 5 + 45).toFixed(1);
        const y = (Math.random() * 5 + 45).toFixed(1);
        dataStream.textContent = `X:${x} Y:${y} Z:--`;
        if (!showMesh) clearMesh();
    }
}
setInterval(idleDetect, 1000); 

async function loadModels() {
    statusText.textContent = "BOOTING AI...";
    try {
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri('./models'),
            faceapi.nets.faceLandmark68TinyNet.loadFromUri('./models')
        ]);
        modelsLoaded = true;
        statusText.textContent = "SYSTEM LIVE";
    } catch (err) {
        statusText.textContent = "CORE ERROR: MODELS MISSING";
    }
}

async function startVideo() {
    statusText.textContent = "REQUESTING SENSORS...";
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } 
        });
        video.srcObject = stream;
        video.setAttribute('playsinline', true);
        return new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                isUsingCamera = true;
                statusText.textContent = "READY";
                resolve(true);
            };
        });
    } catch (e) {
        isUsingCamera = false;
        statusText.textContent = "CAMERA BLOCKED";
        return false;
    }
}

function stopVideo() {
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
        isUsingCamera = false;
    }
}

function setScanning(state) {
    isScanning = state;
    if (state) {
        document.body.classList.add('scanning');
        analyzeBtn.disabled = true;
        analyzeBtn.textContent = "ANALYZING...";
    } else {
        document.body.classList.remove('scanning');
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = "ANALYZE VIBE";
    }
}

function drawMesh(detection) {
    const displaySize = { width: video.clientWidth, height: video.clientHeight };
    faceapi.matchDimensions(canvas, displaySize);
    const resized = faceapi.resizeResults(detection, displaySize);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = modePalettes[currentMode].a;
    ctx.globalAlpha = 0.6;
    const points = resized.landmarks ? resized.landmarks.positions : [];
    points.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5, 0, 2 * Math.PI);
        ctx.fill();
    });
}

function clearMesh() {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// Math Helpers for Scoring
const getDistance = (p1, p2) => Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
const getAngle = (a, b, c) => {
    const ab = { x: a.x - b.x, y: a.y - b.y };
    const cb = { x: c.x - b.x, y: c.y - b.y };
    const dot = ab.x * cb.x + ab.y * cb.y;
    const magAB = Math.sqrt(ab.x * ab.x + ab.y * ab.y);
    const magCB = Math.sqrt(cb.x * cb.x + cb.y * cb.y);
    return (Math.acos(Math.max(-1, Math.min(1, dot / (magAB * magCB)))) * 180) / Math.PI;
};

const getRankColor = (score) => {
    if (score >= 90) return '#FFD700'; 
    if (score >= 75) return 'var(--accent-neon)'; 
    if (score >= 55) return '#00d4ff'; 
    if (score >= 40) return '#ffa500'; 
    return '#ff4444'; 
};

// --- SCORING ENGINE ---

function calculateChadScore(landmarks) {
    const jaw = landmarks.getJawOutline();
    const nose = landmarks.getNose();
    const mouth = landmarks.getMouth();
    const jawWidth = getDistance(jaw[0], jaw[16]);
    const faceHeight = getDistance(nose[0], jaw[8]);
    const baseRatio = jawWidth / faceHeight;
    const taperScore = 100 - Math.abs((jawWidth / getDistance(mouth[0], mouth[6])) - 2.1) * 40;
    const curveScore = 100 - Math.abs(((getAngle(jaw[0], jaw[4], jaw[8]) + getAngle(jaw[16], jaw[12], jaw[8])) / 2) - 70) * 1.2;

    let baseScore = ((100 - Math.abs(baseRatio - 1.65) * 60) * 0.4) + (taperScore * 0.3) + (curveScore * 0.3);
    const angleAsym = Math.abs(getAngle(jaw[0], jaw[4], jaw[8]) - getAngle(jaw[16], jaw[12], jaw[8]));
    baseScore += (Math.max(0, 15 - Math.min(30, angleAsym)) / 15 - 0.5) * 6;
    baseScore = strictnessMode === 'strict' ? (baseScore * 0.89) - 3 : (baseScore * 1.15) + 6;

    const score = Math.max(10, Math.min(99, Math.round(baseScore)));
    const ranks = [
        { s: 88, r: "GIGACHAD" }, { s: 80, r: "ELITE CHAD" }, { s: 70, r: "REAL CHAD" },
        { s: 64, r: "CHAD ADJACENT" }, { s: 54, r: "BASED" }, { s: 45, r: "DECENT" }, { s: 32, r: "MID" }
    ];
    return { score, rank: ranks.find(r => score >= r.s)?.r || "NPC ENERGY" };
}

function calculateStacyScore(landmarks) {
    const jaw = landmarks.getJawOutline();
    const nose = landmarks.getNose();
    const mouth = landmarks.getMouth();
    const leftEye = landmarks.getLeftEye();
    const rightEye = landmarks.getRightEye();

    // 1. Feature Extraction
    const faceSize = getDistance(jaw[0], jaw[16]);
    const eyeLevelY = (leftEye[0].y + rightEye[3].y) / 2;
    const midfaceHeight = mouth[3].y - eyeLevelY;
    const totalFaceHeight = getDistance(nose[0], jaw[8]);
    
    // Ratios
    const midfaceRatio = midfaceHeight / totalFaceHeight;
    const taperedRatio = getDistance(jaw[0], jaw[16]) / getDistance(jaw[4], jaw[12]);
    const tilt = ((leftEye[0].y - leftEye[3].y) + (rightEye[3].y - rightEye[0].y)) / 2;

    // --- THE "CHAD-STYLE" SCORING ENGINE ---
    // Instead of adding points to 0, we subtract "flaws" from 100.
    
    // A. Midface Score (Target: 0.37)
    const midfaceScore = 100 - Math.abs(midfaceRatio - 0.37) * 500;
    
    // B. Jaw Score (Target: 1.25)
    const jawScore = 100 - Math.abs(taperedRatio - 1.25) * 100;
    
    // C. Tilt Score (Target: 2.0+ pixels of upward flick)
    const tiltScore = 70 + (tilt * 10); // Rewards positive tilt, floors at 70

    // Weighted Average (40% Midface, 30% Jaw, 30% Tilt)
    let baseScore = (midfaceScore * 0.4) + (jawScore * 0.3) + (tiltScore * 0.3);

    // --- SYSTEM CALIBRATION (Strict vs Lenient) ---
    // This is the "Out of the Box" part: 
    // We force the score into the 50-95 range so "Becky" is a choice, not a bug.
    if (strictnessMode === 'strict') {
        baseScore = (baseScore * 0.85) - 5;
    } else {
        baseScore = (baseScore * 1.12) + 10;
    }

    const score = Math.max(10, Math.min(99, Math.round(baseScore)));
    
    const ranks = [
        { s: 88, r: "SHES HARDCORE" },
        { s: 78, r: "TRUE STACY" },
        { s: 68, r: "REAL STACY" },
        { s: 58, r: "CLOSE ENOUGH" },
        { s: 45, r: "MORE OF A BECKY" }
    ];

    return { score, rank: ranks.find(r => score >= r.s)?.r || "STACY? NAH, TRY KAREN" };
}
function calculateWifeScore(landmarks) {
    const jaw = landmarks.getJawOutline();
    const nose = landmarks.getNose();
    const mouth = landmarks.getMouth();
    const leftEye = landmarks.getLeftEye();
    const rightEye = landmarks.getRightEye();

    const lTilt = leftEye[0].y - leftEye[3].y;
    const rTilt = rightEye[3].y - rightEye[0].y;
    const midfaceHeight = mouth[3].y - ((leftEye[0].y + rightEye[3].y) / 2);
    const totalHeight = getDistance(nose[0], jaw[8]);
    const midRatio = midfaceHeight / totalHeight;

    let baseScore = ((100 - (Math.max(0, lTilt + rTilt) * 10)) * 0.25) +
                    ((100 - Math.max(0, (midRatio - 0.36) * 600)) * 0.3) + 25;

    baseScore = strictnessMode === 'strict' ? (baseScore * 0.86) - 4 : (baseScore * 1.14) + 6;
    const score = Math.max(10, Math.min(99, Math.round(baseScore)));
    const ranks = [
        { s: 92, r: "GOD-TIER WIFE MATERIAL" }, { s: 85, r: "MYTHICAL WIFE MATERIAL" },
        { s: 76, r: "TOP-TIER WIFEY" }, { s: 65, r: "SOLID RELATIONSHIP CORE" },
        { s: 55, r: "RESPECTABLE PARTNER" }, { s: 45, r: "WORK IN PROGRESS" }, { s: 32, r: "IT’S COMPLICATED" }
    ];
    return { score, rank: ranks.find(r => score >= r.s)?.r || "WALKING RED FLAG" };
}

function calculateHusbandScore(landmarks) {
    const jaw = landmarks.getJawOutline();
    const nose = landmarks.getNose();
    const totalHeight = getDistance(nose[0], jaw[8]);
    const jawWidth = getDistance(jaw[0], jaw[16]);
    const fWHR = jawWidth / totalHeight;

    let baseScore = ((100 - Math.abs(fWHR - 1.55) * 140) * 0.3) + 50;
    baseScore = strictnessMode === 'strict' ? (baseScore * 0.87) - 4 : (baseScore * 1.12) + 5;

    const score = Math.max(10, Math.min(99, Math.round(baseScore)));
    const ranks = [
        { s: 92, r: "MASTER OF THE HOUSE" }, { s: 84, r: "MAN OF THE HOUSE" },
        { s: 75, r: "PEAK HUSBAND" }, { s: 62, r: "RESPECTABLE PARTNER" }, { s: 48, r: "MILK RUN PENDING" }
    ];
    return { score, rank: ranks.find(r => score >= r.s)?.r || "ALREADY ABSENT" };
}

// --- SYSTEM CORE ---

function getVibeResult(landmarks) {
    if (currentMode === 'chad') return calculateChadScore(landmarks);
    if (currentMode === 'stacy') return calculateStacyScore(landmarks);
    if (currentMode === 'husband') return calculateHusbandScore(landmarks);
    // Defaults to Wife Mode
    return calculateWifeScore(landmarks);
}

/**
 * DIRECT IMAGE LOADER
 * Surmounts mobile focus loss and RAM constraints.
 */
imageUpload.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file || !modelsLoaded) return;

    stopVideo(); // Release GPU hardware for file processing

    statusText.textContent = "DECRYPTING...";
    setScanning(true);
    
    const reader = new FileReader();
    reader.onload = function(event) {
        const img = new Image();
        img.onload = function() {
            faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
                .withFaceLandmarks(true)
                .then(det => {
                    if (!det) {
                        statusText.textContent = "NO FACE FOUND";
                        setScanning(false);
                    } else {
                        const res = getVibeResult(det.landmarks);
                        showResult(res.rank, res.score);
                        setScanning(false);
                    }
                    imageUpload.value = "";
                })
                .catch(() => {
                    statusText.textContent = "DECODE ERROR";
                    setScanning(false);
                });
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

analyzeBtn.addEventListener('click', async () => {
    if (!modelsLoaded) return;
    if (!isUsingCamera) {
        const success = await startVideo();
        if (!success) return;
    }
    setScanning(true);
    statusText.textContent = "LOCKING...";
    let bestDet = null;
    for (let i = 0; i < 25; i++) {
        const det = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks(true);
        if (det) {
            bestDet = det;
            if (showMesh) drawMesh(det);
            const progress = Math.round((i / 25) * 100);
            dataStream.textContent = `DECRYPTING: ${progress}%`;
        }
        await new Promise(r => setTimeout(r, 120));
    }
    if (!bestDet) { 
        statusText.textContent = "LOCK LOST"; 
        setScanning(false); 
        clearMesh();
        return; 
    }
    const res = getVibeResult(bestDet.landmarks);
    statusText.textContent = "FINALIZING...";
    setTimeout(() => {
        showResult(res.rank, res.score);
        setScanning(false);
        if (!showMesh) clearMesh();
    }, 800);
});

function showResult(title, score) {
    viewfinder.classList.add('flash');
    if (score >= 84) viewfinder.classList.add('impact');
    setTimeout(() => { viewfinder.classList.remove('flash', 'impact'); }, 400);
    
    resultTitle.textContent = title;
    const color = getRankColor(score);
    resultTitle.style.borderColor = color;
    
    const label = (currentMode === 'chad' || currentMode === 'stacy') ? 'MOG LEVEL' : 'VIBE SCORE';
    statsOutput.innerHTML = `<div style="color: ${color}">${label}: <span id="val">0%</span></div>`;
    
    resultCard.classList.remove('hidden');
    requestAnimationFrame(() => {
        resultCard.classList.add('active');
        let count = 0;
        const interval = setInterval(() => {
            count += 2;
            if (count >= score) { count = score; clearInterval(interval); }
            const valSpan = document.getElementById('val');
            if(valSpan) valSpan.textContent = count + "%";
        }, 20);
    });
    if (window.navigator.vibrate) window.navigator.vibrate(60);
}

closeBtn.addEventListener('click', () => { 
    resultCard.classList.remove('active'); 
    setTimeout(() => resultCard.classList.add('hidden'), 500); 
});

// STACY Color Palette (High-Fashion Purple)
const modePalettes = { 
    chad: { a: '#00ff9d' }, 
    stacy: { a: '#bf00ff' }, 
    wife: { a: '#ff4fd8' }, 
    husband: { a: '#ffd54a' } 
};

modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        modeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.dataset.mode;
        document.documentElement.style.setProperty('--accent-neon', modePalettes[currentMode].a);
    });
});

strictnessButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        strictnessButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        strictnessMode = btn.dataset.strictness;
    });
});

loadModels();

// Privacy Popup Logic
const privacyPopup = document.getElementById('privacy-popup');
const closePrivacyBtn = document.getElementById('close-privacy');

closePrivacyBtn.addEventListener('click', () => {
    privacyPopup.classList.add('fade-out');
    // Optional: Start the video automatically after they agree
    if (!isUsingCamera) startVideo();
});