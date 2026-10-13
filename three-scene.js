// Money Mastery 3D layer (three.js).
// Purely presentational: it listens for the app's `mm:render` event and never writes app state.
// If WebGL or the module fails, the app keeps working with its normal 2D surfaces.
import * as THREE from './vendor/three.module.min.js';

const root = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const isDark = () => root.classList.contains('dark');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = t => 1 - Math.pow(1 - t, 3);
const money = n => (Number(n) || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 });
const compact = n => {
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K';
    return money(n);
};
const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PALETTE = ['#7c6cff', '#ff5d8f', '#ffc857', '#2ec4b6', '#4d9bff', '#c77dff', '#ff8a5b', '#5ee0a0'];
const TYPE_COLORS = { Income: '#06D6A0', Expense: '#EF476F', Saving: '#FFD166', Investment: '#8338EC', FreeCashFlow: '#118AB2', Remain: '#7dd3fc' };

function supportsWebGL() {
    try {
        const c = document.createElement('canvas');
        return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch { return false; }
}

// A tiny procedural environment so metallic materials have something to reflect.
function makeEnvironment(renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const scene = new THREE.Scene();
    const sky = new THREE.Mesh(
        new THREE.SphereGeometry(10, 32, 16),
        new THREE.ShaderMaterial({
            side: THREE.BackSide,
            uniforms: {},
            vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
            fragmentShader: 'varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 top = vec3(0.55,0.5,1.0); vec3 mid = vec3(0.12,0.1,0.3); vec3 bot = vec3(0.02,0.03,0.08); vec3 c = h > 0.0 ? mix(mid, top, h) : mix(mid, bot, -h); gl_FragColor = vec4(c,1.0); }'
        })
    );
    scene.add(sky);
    const panel = (color, x, y, z, s) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
        m.position.set(x, y, z); m.lookAt(0, 0, 0); scene.add(m);
    };
    panel(0xffffff, 0, 6, 4, 5);
    panel(0xffd27a, 7, 2, -2, 4);
    panel(0x7aa2ff, -7, 1, 2, 4);
    panel(0xff6fa8, 2, -5, -6, 3);
    const env = pmrem.fromScene(scene, 0.04).texture;
    pmrem.dispose();
    return env;
}

function coinFaceTexture(symbol = '฿', tint = '#f5c451') {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(100, 90, 20, 128, 128, 128);
    grad.addColorStop(0, '#fff6d1'); grad.addColorStop(0.55, tint); grad.addColorStop(1, '#9a6a12');
    g.fillStyle = grad; g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(120,80,10,.55)'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 104, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(110,70,5,.85)'; g.font = '700 128px Kanit, "Space Mono", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(symbol, 128, 138);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}

function makeCoin(env, { radius = 1, depth = 0.16, tint = '#f5c451', symbol = '฿' } = {}) {
    const geo = new THREE.CylinderGeometry(radius, radius, depth, 64, 1);
    geo.rotateX(Math.PI / 2); // face the camera
    const face = coinFaceTexture(symbol, tint);
    const side = new THREE.MeshStandardMaterial({ color: tint, metalness: 1, roughness: 0.28, envMap: env });
    const cap = new THREE.MeshStandardMaterial({ map: face, metalness: 0.85, roughness: 0.3, envMap: env });
    return new THREE.Mesh(geo, [side, cap, cap]);
}

// One renderer per host element. Renders only while visible on screen and the tab is visible.
class View {
    constructor(host, { alpha = true, fov = 40, dprCap = 1.75 } = {}) {
        this.host = host;
        this.canvas = host.tagName === 'CANVAS' ? host : host.appendChild(document.createElement('canvas'));
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha, powerPreference: 'low-power' });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, dprCap));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 200);
        this.env = makeEnvironment(this.renderer);
        this.visible = false;
        this.clock = new THREE.Clock();
        this.resize = this.resize.bind(this);
        if (host.tagName === 'CANVAS') addEventListener('resize', this.resize);
        else new ResizeObserver(this.resize).observe(host);
        new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) this.kick(); }, { rootMargin: '80px' }).observe(host);
        this.resize();
    }
    get size() {
        if (this.host.tagName === 'CANVAS') return { w: innerWidth, h: innerHeight };
        const r = this.host.getBoundingClientRect();
        return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
    }
    resize() {
        const { w, h } = this.size;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.onResize?.(w, h);
        this.kick();
    }
    kick() {
        if (this.raf || !this.visible || document.hidden) return;
        const loop = () => {
            this.raf = 0;
            if (!this.visible || document.hidden) return;
            const dt = Math.min(this.clock.getDelta(), 0.05);
            // Reduced motion: jump every animation to its end state and draw a single frame.
            const keepGoing = this.tick?.(reduceMotion.matches ? 100 : dt, this.clock.elapsedTime) !== false;
            this.renderer.render(this.scene, this.camera);
            if (keepGoing && !reduceMotion.matches) this.raf = requestAnimationFrame(loop);
        };
        this.clock.getDelta();
        this.raf = requestAnimationFrame(loop);
    }
}

// Drag-to-orbit for chart scenes. Pointer events only; vertical scrolling stays native on touch.
function attachOrbit(view, target, { yaw = -0.5, pitch = 0.45, auto = 0.12 } = {}) {
    const st = { yaw, pitch, vy: 0, dragging: false, lastX: 0, lastY: 0, idle: 0 };
    const el = view.canvas;
    el.style.touchAction = 'pan-y';
    el.addEventListener('pointerdown', e => { st.dragging = true; st.lastX = e.clientX; st.lastY = e.clientY; el.setPointerCapture(e.pointerId); view.kick(); });
    el.addEventListener('pointermove', e => {
        if (!st.dragging) return;
        st.vy = (e.clientX - st.lastX) * 0.006;
        st.yaw += st.vy;
        st.pitch = clamp(st.pitch + (e.clientY - st.lastY) * 0.003, 0.12, 1.1);
        st.lastX = e.clientX; st.lastY = e.clientY; st.idle = 0;
        view.kick();
    });
    const end = () => { st.dragging = false; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    return dt => {
        st.idle += dt;
        if (!st.dragging) {
            st.vy *= 0.92;
            st.yaw += st.vy + (st.idle > 2 && !reduceMotion.matches ? auto * dt : 0);
        }
        target.rotation.y = st.yaw;
        target.rotation.x = st.pitch * 0.35;
    };
}

// HTML labels that follow 3D anchors.
function labelLayer(host) {
    const layer = document.createElement('div');
    layer.className = 'mm3d-labels';
    host.appendChild(layer);
    const items = [];
    const v = new THREE.Vector3();
    return {
        set(list) {
            layer.textContent = '';
            items.length = 0;
            for (const it of list) {
                const el = document.createElement('div');
                el.className = 'mm3d-label' + (it.className ? ' ' + it.className : '');
                el.innerHTML = it.html;
                layer.appendChild(el);
                items.push({ el, anchor: it.anchor });
            }
        },
        update(camera, w, h) {
            for (const { el, anchor } of items) {
                anchor.getWorldPosition(v);
                v.project(camera);
                const hidden = v.z > 1;
                el.style.transform = `translate(-50%,-100%) translate(${(v.x * 0.5 + 0.5) * w}px,${(-v.y * 0.5 + 0.5) * h}px)`;
                el.style.opacity = hidden ? 0 : 1;
            }
        }
    };
}

// Chart floors read as dark glass in dark mode and frosted lilac in light mode.
function themeFloor(view, mesh, dark = 0x23244a, light = 0xd9ddff) {
    const apply = () => { mesh.material.color.set(isDark() ? dark : light); view.kick(); };
    new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['class'] });
    apply();
}

/* ---------------------------------------------------------------- */
/* 1. Ambient background: floating coins, crystal and star dust      */
/* ---------------------------------------------------------------- */
function initBackground() {
    const canvas = document.createElement('canvas');
    canvas.id = 'mm3d-bg';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);
    const view = new View(canvas, { fov: 55, dprCap: 1.5 });
    const env = view.env;
    view.visible = true;
    const { scene, camera } = view;
    camera.position.set(0, 0, 18);
    scene.fog = new THREE.FogExp2(0x0b0d1f, 0.028);

    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(4, 6, 8); scene.add(key);
    const violet = new THREE.PointLight(0x8b5cf6, 60, 40); violet.position.set(-8, -2, 6); scene.add(violet);
    const cyan = new THREE.PointLight(0x22d3ee, 40, 40); cyan.position.set(9, 4, 2); scene.add(cyan);

    // Star dust
    const N = innerWidth < 700 ? 700 : 1500;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const tints = [new THREE.Color('#8b9dff'), new THREE.Color('#c084fc'), new THREE.Color('#67e8f9'), new THREE.Color('#ffffff')];
    for (let i = 0; i < N; i++) {
        const r = 12 + Math.random() * 38, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
        pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.7, r * Math.sin(ph) * Math.sin(th) - 10], i * 3);
        const c = tints[i % tints.length]; col.set([c.r, c.g, c.b], i * 3);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dustGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const dot = (() => {
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
    })();
    const dustMat = new THREE.PointsMaterial({ size: 0.32, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 });
    const dust = new THREE.Points(dustGeo, dustMat);
    scene.add(dust);

    // Crystal: glassy icosahedron with a glowing wireframe shell
    const crystal = new THREE.Group();
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(2.6, 0), new THREE.MeshPhysicalMaterial({
        color: 0x9f8cff, metalness: 0.1, roughness: 0.08, transmission: 0.6, thickness: 1.2, envMap: env, envMapIntensity: 1.4, transparent: true, opacity: 0.85, flatShading: true
    }));
    const shell = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(3.4, 1)), new THREE.LineBasicMaterial({ color: 0x8ea2ff, transparent: true, opacity: 0.28 }));
    crystal.add(core, shell);
    crystal.position.set(9, 3.5, -6);
    scene.add(crystal);

    // Halo ring
    const ring = new THREE.Mesh(new THREE.TorusGeometry(7.5, 0.035, 8, 160), new THREE.MeshBasicMaterial({ color: 0x7c6cff, transparent: true, opacity: 0.35 }));
    ring.rotation.set(1.2, 0.2, 0);
    ring.position.set(9, 3.5, -6);
    scene.add(ring);

    // Floating coins
    const coins = [];
    const coinCount = innerWidth < 700 ? 6 : 11;
    const coinTints = ['#f5c451', '#f5c451', '#c9b6ff', '#f5c451', '#9be7ff'];
    for (let i = 0; i < coinCount; i++) {
        const coin = makeCoin(env, { radius: 0.55 + Math.random() * 0.6, tint: coinTints[i % coinTints.length], symbol: i % 4 === 3 ? '$' : '฿' });
        const home = new THREE.Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 18, -4 - Math.random() * 14);
        coin.position.copy(home);
        coin.rotation.set(Math.random() * 3, Math.random() * 3, 0);
        coin.userData = { home, spin: 0.2 + Math.random() * 0.6, bob: Math.random() * Math.PI * 2 };
        coins.push(coin); scene.add(coin);
    }

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    addEventListener('pointermove', e => { pointer.tx = e.clientX / innerWidth - 0.5; pointer.ty = e.clientY / innerHeight - 0.5; }, { passive: true });
    let scrollY = scrollY0();
    function scrollY0() { return window.scrollY || 0; }
    addEventListener('scroll', () => { scrollY = scrollY0(); }, { passive: true });

    const applyTheme = () => {
        const dark = isDark();
        scene.fog.color.set(dark ? 0x0b0d1f : 0xeef1ff);
        dustMat.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
        dustMat.opacity = dark ? 0.85 : 0.45;
        dustMat.size = dark ? 0.32 : 0.22;
        dustMat.needsUpdate = true;
        shell.material.color.set(dark ? 0x8ea2ff : 0x5b5bd6);
        shell.material.opacity = dark ? 0.28 : 0.35;
        ring.material.opacity = dark ? 0.35 : 0.22;
        view.renderer.toneMappingExposure = dark ? 1 : 1.15;
        view.kick();
    };
    new MutationObserver(applyTheme).observe(root, { attributes: true, attributeFilter: ['class'] });
    applyTheme();

    view.tick = (dt, t) => {
        pointer.x += (pointer.tx - pointer.x) * 0.04;
        pointer.y += (pointer.ty - pointer.y) * 0.04;
        camera.position.x = pointer.x * 3;
        camera.position.y = -pointer.y * 2 - scrollY * 0.004;
        camera.lookAt(0, -scrollY * 0.004, 0);
        dust.rotation.y = t * 0.012;
        dust.rotation.x = Math.sin(t * 0.05) * 0.05;
        crystal.rotation.y = t * 0.15;
        crystal.rotation.x = Math.sin(t * 0.3) * 0.25;
        ring.rotation.z = t * 0.08;
        for (const c of coins) {
            const u = c.userData;
            c.rotation.y += dt * u.spin;
            c.rotation.x += dt * u.spin * 0.3;
            c.position.y = u.home.y + Math.sin(t * 0.6 + u.bob) * 0.6 + scrollY * 0.002 * (1 + u.home.z / -20);
        }
    };
    return view;
}

/* ---------------------------------------------------------------- */
/* 2. Hero coin with a composition ring on the net-balance card      */
/* ---------------------------------------------------------------- */
function initHeroCoin() {
    const card = document.querySelector('.net-balance-card');
    if (!card) return null;
    const host = document.createElement('div');
    host.className = 'mm3d-hero';
    host.setAttribute('aria-hidden', 'true');
    card.appendChild(host);
    card.classList.add('has-3d');
    const view = new View(host, { fov: 35 });
    const env = view.env;
    const { scene, camera } = view;
    camera.position.set(0, 0, 7.2);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const l = new THREE.DirectionalLight(0xffffff, 2.2); l.position.set(3, 4, 6); scene.add(l);
    const rim = new THREE.PointLight(0xb69bff, 30, 20); rim.position.set(-3, -2, 3); scene.add(rim);

    const group = new THREE.Group();
    scene.add(group);
    const coin = makeCoin(env, { radius: 1.15, depth: 0.22 });
    group.add(coin);

    const ringGroup = new THREE.Group();
    ringGroup.rotation.x = 1.15;
    group.add(ringGroup);
    const track = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.03, 8, 120), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 }));
    ringGroup.add(track);
    let arcs = [];
    const current = { parts: [] };

    const setParts = parts => {
        arcs.forEach(a => { ringGroup.remove(a); a.geometry.dispose(); a.material.dispose(); });
        arcs = [];
        const total = parts.reduce((s, p) => s + p.value, 0);
        if (!total) return;
        let start = 0;
        const gap = parts.length > 1 ? 0.06 : 0;
        for (const p of parts) {
            const len = (p.value / total) * Math.PI * 2;
            if (len - gap <= 0.01) { start += len; continue; }
            const m = new THREE.Mesh(
                new THREE.TorusGeometry(1.85, 0.11, 12, Math.max(8, Math.round(len * 24)), len - gap),
                new THREE.MeshStandardMaterial({ color: p.color, emissive: p.color, emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.35, envMap: env })
            );
            m.rotation.z = start;
            m.userData.grow = 0;
            ringGroup.add(m);
            arcs.push(m);
            start += len;
        }
    };

    let mood = 0, moodTarget = 0, spinBoost = 0;
    const side = coin.material[0];
    const gold = new THREE.Color('#f5c451'), rose = new THREE.Color('#ff7a9a');
    view.update = ({ summary, balance }) => {
        const parts = [
            { value: summary.Expense, color: TYPE_COLORS.Expense },
            { value: Math.max(0, summary.Saving), color: TYPE_COLORS.Saving },
            { value: Math.max(0, summary.Investment), color: TYPE_COLORS.Investment },
            { value: Math.max(0, summary.FreeCashFlow), color: TYPE_COLORS.FreeCashFlow },
            { value: Math.max(0, balance), color: TYPE_COLORS.Income }
        ].filter(p => p.value > 0);
        const sig = JSON.stringify(parts.map(p => Math.round(p.value)));
        if (sig !== current.sig) { current.sig = sig; setParts(parts); spinBoost = 6; }
        moodTarget = balance < 0 ? 1 : 0;
        view.kick();
    };

    view.tick = (dt, t) => {
        spinBoost *= 0.95;
        coin.rotation.y += dt * (0.8 + spinBoost);
        coin.rotation.x = Math.sin(t * 0.8) * 0.15;
        group.position.y = Math.sin(t * 1.2) * 0.08;
        ringGroup.rotation.z -= dt * 0.25;
        for (const a of arcs) { a.userData.grow = Math.min(1, a.userData.grow + dt * 1.4); a.scale.setScalar(0.6 + ease(a.userData.grow) * 0.4); }
        mood += (moodTarget - mood) * 0.05;
        side.color.copy(gold).lerp(rose, mood);
    };
    return view;
}

/* ---------------------------------------------------------------- */
/* 3. Expense city: categories as towers on a glass platform         */
/* ---------------------------------------------------------------- */
function sectionShell({ id, eyebrow, title, subtitle, hint }) {
    const sec = document.createElement('section');
    sec.id = id;
    sec.className = 'retro-panel mm3d-panel';
    sec.innerHTML = `
        <div class="mm3d-head">
            <div><span class="mm3d-eyebrow">${eyebrow}</span><h3>${title}</h3><p>${subtitle}</p></div>
            <span class="mm3d-hint"><i class="ph-bold ph-hand-grabbing"></i> ${hint}</span>
        </div>
        <div class="mm3d-stage"><div class="mm3d-empty" hidden></div></div>
        <div class="mm3d-legend"></div>`;
    return sec;
}

function initCity() {
    const page = document.getElementById('dashboard-page');
    const anchor = page?.querySelector('#upcoming-bills') || page?.querySelector('.modern-widgets');
    if (!anchor) return null;
    const sec = sectionShell({ id: 'mm3d-city', eyebrow: '3D SPENDING CITY', title: 'เมืองรายจ่ายของรอบนี้', subtitle: 'ตึกยิ่งสูง ยิ่งกินเงินเยอะ — หมวดไหนเป็นตึกระฟ้า ก็รู้แล้วนะว่าเงินไปไหน', hint: 'ลากเพื่อหมุน' });
    anchor.before(sec);
    const stage = sec.querySelector('.mm3d-stage');
    const empty = sec.querySelector('.mm3d-empty');
    const legend = sec.querySelector('.mm3d-legend');
    const view = new View(stage, { fov: 38 });
    const env = view.env;
    const { scene, camera } = view;
    // Pull the camera back on narrow stages so the whole platform stays in frame.
    view.onResize = (w, h) => {
        // Visible width at distance d is ~0.69·d·aspect for this fov; keep ~14 units (the platform) in view.
        const d = Math.max(15, 14 / (0.69 * (w / h)));
        camera.position.set(0, d * 0.52, d);
        camera.lookAt(0, 1.6, 0);
    };
    view.resize();
    scene.add(new THREE.HemisphereLight(0xc7d2ff, 0x1a1033, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(5, 10, 6); scene.add(sun);

    const world = new THREE.Group();
    scene.add(world);
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 6.8, 0.45, 72), new THREE.MeshPhysicalMaterial({ color: 0x23244a, metalness: 0.4, roughness: 0.25, clearcoat: 1, envMap: env, envMapIntensity: 0.7 }));
    platform.position.y = -0.25;
    world.add(platform);
    themeFloor(view, platform);
    const grid = new THREE.PolarGridHelper(6.2, 12, 6, 72, 0x6d6bff, 0x3b3a78);
    grid.position.y = 0.0;
    grid.material.transparent = true; grid.material.opacity = 0.45;
    world.add(grid);
    const glow = new THREE.Mesh(new THREE.TorusGeometry(6.6, 0.05, 8, 140), new THREE.MeshBasicMaterial({ color: 0x8b7bff }));
    glow.rotation.x = Math.PI / 2; glow.position.y = -0.02;
    world.add(glow);

    const labels = labelLayer(stage);
    const orbit = attachOrbit(view, world, { yaw: -0.35, pitch: 0.4 });
    let towers = [];
    let sig = '';

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2(9, 9);
    let hovered = null;
    view.canvas.addEventListener('pointermove', e => {
        const r = view.canvas.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        view.kick();
    });
    view.canvas.addEventListener('pointerleave', () => ndc.set(9, 9));

    const build = rows => {
        towers.forEach(t => { world.remove(t); t.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); });
        towers = [];
        const max = Math.max(...rows.map(r => r.value), 1);
        const n = rows.length;
        const radius = n <= 1 ? 0 : n <= 4 ? 2.6 : 3.6;
        rows.forEach((row, i) => {
            const color = new THREE.Color(PALETTE[i % PALETTE.length]);
            // sqrt keeps small categories readable next to a dominant one; labels carry exact amounts.
            const h = 0.4 + Math.sqrt(row.value / max) * 5;
            const w = n > 6 ? 0.95 : 1.2;
            const g = new THREE.Group();
            const ang = (i / Math.max(n, 1)) * Math.PI * 2 + Math.PI / 2;
            g.position.set(Math.cos(ang) * radius, 0, Math.sin(ang) * radius);
            const body = new THREE.Mesh(new THREE.BoxGeometry(w, 1, w), new THREE.MeshPhysicalMaterial({
                color, metalness: 0.2, roughness: 0.2, clearcoat: 1, envMap: env, envMapIntensity: 1, transparent: true, opacity: 0.92, emissive: color, emissiveIntensity: 0.12
            }));
            body.position.y = 0.5;
            const edges = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
            body.add(edges);
            // Window strips give the towers a skyline feel.
            const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 1.06, 0.08, w * 1.06), new THREE.MeshBasicMaterial({ color }));
            const top = new THREE.Object3D();
            g.add(body, cap, top);
            g.userData = { h, grow: 0, delay: i * 0.08, body, cap, top, row, color };
            world.add(g);
            towers.push(g);
        });
        labels.set(towers.map(t => ({ anchor: t.userData.top, html: `<b>${escapeHTML(t.userData.row.name)}</b><span>${compact(t.userData.row.value)}</span>` })));
        legend.innerHTML = rows.map((r, i) => `<span><i style="background:${PALETTE[i % PALETTE.length]}"></i>${escapeHTML(r.name)} <b>${money(r.value)}</b> <em>${r.share.toFixed(1)}%</em></span>`).join('');
    };

    view.update = ({ cycleTrans }) => {
        const by = new Map();
        for (const t of cycleTrans) if (t.Type === 'Expense') by.set(t.Category || 'อื่นๆ', (by.get(t.Category || 'อื่นๆ') || 0) + (parseFloat(t.Amount) || 0));
        let rows = [...by.entries()].map(([name, value]) => ({ name, value })).filter(r => r.value > 0).sort((a, b) => b.value - a.value);
        const total = rows.reduce((s, r) => s + r.value, 0);
        if (rows.length > 8) {
            const rest = rows.slice(7).reduce((s, r) => s + r.value, 0);
            rows = [...rows.slice(0, 7), { name: 'อื่นๆ', value: rest }];
        }
        rows.forEach(r => { r.share = total ? (r.value / total) * 100 : 0; });
        const next = JSON.stringify(rows.map(r => [r.name, Math.round(r.value)]));
        if (next === sig) return;
        sig = next;
        empty.hidden = rows.length > 0;
        empty.textContent = 'รอบนี้ยังไม่มีรายจ่าย เมืองเลยยังเป็นที่ดินเปล่า 🏜️ (เก่งมาก หรือยังไม่ได้จดกันแน่?)';
        build(rows);
        view.kick();
    };

    view.tick = (dt, t) => {
        orbit(dt);
        glow.material.color.setHSL(0.7 + Math.sin(t * 0.5) * 0.05, 0.9, 0.65);
        raycaster.setFromCamera(ndc, camera);
        const hit = raycaster.intersectObjects(towers.map(x => x.userData.body), false)[0];
        hovered = hit ? towers.find(x => x.userData.body === hit.object) : null;
        for (const tw of towers) {
            const u = tw.userData;
            u.grow = Math.min(1, u.grow + dt * 0.9);
            const k = ease(clamp((u.grow - u.delay) / (1 - u.delay), 0, 1));
            const h = Math.max(0.001, u.h * k);
            u.body.scale.y = h; u.body.position.y = h / 2;
            u.cap.position.y = h + 0.04;
            u.top.position.y = h + 0.25;
            const target = tw === hovered ? 0.55 : 0.12;
            u.body.material.emissiveIntensity += (target - u.body.material.emissiveIntensity) * 0.15;
        }
        labels.update(camera, view.size.w, view.size.h);
    };
    return view;
}

/* ---------------------------------------------------------------- */
/* 4. Analytics timeline: last six billing cycles as 3D bar rows      */
/* ---------------------------------------------------------------- */
function initTimeline() {
    const page = document.getElementById('analytics-page');
    const insights = page?.querySelector('#report-insights');
    if (!insights) return null;
    const sec = sectionShell({ id: 'mm3d-timeline', eyebrow: '3D CASHFLOW TIMELINE', title: 'กระแสเงิน 6 รอบบัญชีล่าสุด', subtitle: 'แถวหน้า = รายรับ, กลาง = รายจ่าย, หลัง = ออม/ลงทุนสุทธิ ดูให้ดีว่าแถวกลางแซงแถวหน้าบ่อยแค่ไหน', hint: 'ลากเพื่อหมุน' });
    insights.after(sec);
    const stage = sec.querySelector('.mm3d-stage');
    const legend = sec.querySelector('.mm3d-legend');
    legend.innerHTML = [['รายรับ', TYPE_COLORS.Income], ['รายจ่าย', TYPE_COLORS.Expense], ['ออม/ลงทุนสุทธิ', TYPE_COLORS.Investment]]
        .map(([n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join('');
    const view = new View(stage, { fov: 36 });
    const env = view.env;
    const { scene, camera } = view;
    view.onResize = (w, h) => {
        const d = Math.max(16.5, 13 / (0.65 * (w / h)));
        stage.classList.toggle('is-narrow', w < 560);
        camera.position.set(0, d * 0.42, d);
        camera.lookAt(0, 1.8, 0);
    };
    view.resize();
    scene.add(new THREE.HemisphereLight(0xd6dcff, 0x1a1033, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(-4, 10, 8); scene.add(sun);
    const world = new THREE.Group();
    scene.add(world);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(13, 0.3, 5.2), new THREE.MeshPhysicalMaterial({ color: 0x1f2145, metalness: 0.3, roughness: 0.3, clearcoat: 1, envMap: env, envMapIntensity: 0.6 }));
    floor.position.y = -0.15;
    world.add(floor);
    themeFloor(view, floor, 0x1f2145, 0xdfe2ff);
    const gridLines = new THREE.GridHelper(13, 26, 0x5b5bd6, 0x30306a);
    gridLines.scale.z = 5.2 / 13; gridLines.position.y = 0.005;
    gridLines.material.transparent = true; gridLines.material.opacity = 0.5;
    world.add(gridLines);
    const labels = labelLayer(stage);
    const orbit = attachOrbit(view, world, { yaw: -0.28, pitch: 0.35, auto: 0.06 });
    let bars = [];
    let sig = '';

    const build = cycles => {
        bars.forEach(b => { world.remove(b); b.geometry.dispose(); b.material.dispose(); });
        bars = [];
        const max = Math.max(1, ...cycles.flatMap(c => [c.income, c.expense, Math.abs(c.saving)]));
        const anchors = [];
        cycles.forEach((c, i) => {
            const x = (i - (cycles.length - 1) / 2) * 2;
            [['income', 1.4], ['expense', 0], ['saving', -1.4]].forEach(([k, z], j) => {
                const v = c[k];
                const color = new THREE.Color([TYPE_COLORS.Income, TYPE_COLORS.Expense, TYPE_COLORS.Investment][j]);
                const h = Math.max(0.03, (Math.abs(v) / max) * 5);
                const bar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1, 0.9), new THREE.MeshPhysicalMaterial({
                    color, metalness: 0.15, roughness: 0.25, clearcoat: 1, envMap: env, transparent: true, opacity: v < 0 ? 0.45 : 0.92, emissive: color, emissiveIntensity: c.current ? 0.35 : 0.1
                }));
                bar.position.set(x, 0, z);
                bar.userData = { h, grow: 0, delay: i * 0.06 + j * 0.04 };
                world.add(bar);
                bars.push(bar);
            });
            const a = new THREE.Object3D();
            a.position.set(x, -0.05, 2.9);
            world.add(a);
            anchors.push({ anchor: a, html: `<b>${escapeHTML(c.label)}</b><span class="${c.income - c.expense >= 0 ? 'up' : 'down'}">${c.income - c.expense >= 0 ? '+' : ''}${compact(c.income - c.expense)}</span>`, className: 'mm3d-axis' + (c.current ? ' is-current' : '') });
            bars.push(a);
        });
        labels.set(anchors);
    };

    view.update = ({ transactions, cycleRange, currentDate }) => {
        if (typeof cycleRange !== 'function' || !currentDate) return;
        const parse = s => { const d = new Date(String(s).replace(' ', 'T').includes('T') ? String(s).replace(' ', 'T') : s + 'T12:00:00'); return isNaN(d) ? null : d; };
        const cycles = [];
        for (let k = 5; k >= 0; k--) {
            const anchorDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - k, 1);
            const { startDate, endDate } = cycleRange(anchorDate);
            cycles.push({ startDate, endDate, income: 0, expense: 0, saving: 0, current: k === 0, label: anchorDate.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' }) });
        }
        for (const t of transactions) {
            const d = parse(t.Date); if (!d) continue;
            const c = cycles.find(c => d >= c.startDate && d < c.endDate); if (!c) continue;
            const a = parseFloat(t.Amount) || 0;
            if (t.Type === 'Income') c.income += a;
            else if (t.Type === 'Expense') c.expense += a;
            else if (['Saving', 'Investment', 'FreeCashFlow'].includes(t.Type)) c.saving += t.IsDeduct ? -a : a;
        }
        const next = JSON.stringify(cycles.map(c => [c.label, Math.round(c.income), Math.round(c.expense), Math.round(c.saving)]));
        if (next === sig) return;
        sig = next;
        build(cycles);
        view.kick();
    };

    view.tick = dt => {
        orbit(dt);
        for (const b of bars) {
            const u = b.userData;
            if (!u || u.h === undefined) continue;
            u.grow = Math.min(1, u.grow + dt * 0.9);
            const k = ease(clamp((u.grow - u.delay) / (1 - u.delay), 0, 1));
            const h = Math.max(0.001, u.h * k);
            b.scale.y = h; b.position.y = h / 2;
        }
        labels.update(camera, view.size.w, view.size.h);
    };
    return view;
}

/* ---------------------------------------------------------------- */
/* 5. Pointer tilt for summary cards (desktop only)                  */
/* ---------------------------------------------------------------- */
function initTilt() {
    if (!finePointer.matches || reduceMotion.matches) return;
    const sel = '#dashboard-page .modern-summary > div, .mm3d-panel, .report-comparison > *';
    document.addEventListener('pointermove', e => {
        const el = e.target.closest?.(sel);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const max = r.width > 500 ? 2.5 : 7;
        el.style.setProperty('--tilt-x', `${(-(e.clientY - r.top) / r.height + 0.5) * max}deg`);
        el.style.setProperty('--tilt-y', `${((e.clientX - r.left) / r.width - 0.5) * max}deg`);
        el.style.setProperty('--glare-x', `${((e.clientX - r.left) / r.width) * 100}%`);
        el.style.setProperty('--glare-y', `${((e.clientY - r.top) / r.height) * 100}%`);
        el.classList.add('is-tilting');
    }, { passive: true });
    document.addEventListener('pointerout', e => {
        const el = e.target.closest?.(sel);
        if (el && !el.contains(e.relatedTarget)) { el.classList.remove('is-tilting'); el.style.removeProperty('--tilt-x'); el.style.removeProperty('--tilt-y'); }
    }, { passive: true });
}

/* ---------------------------------------------------------------- */
function summarize(cycleTrans) {
    const summary = { Income: 0, Expense: 0, Saving: 0, Investment: 0, FreeCashFlow: 0 };
    let savingDeposit = 0;
    for (const t of cycleTrans) {
        const a = parseFloat(t.Amount) || 0;
        if (t.Type === 'Income') summary.Income += a;
        else if (t.Type === 'Expense') summary.Expense += a;
        else if (t.Type === 'Saving') { summary.Saving += t.IsDeduct ? -a : a; if (!t.IsDeduct) savingDeposit += a; }
        else if (t.Type === 'Investment') summary.Investment += t.IsDeduct ? -a : a;
        else if (t.Type === 'FreeCashFlow') summary.FreeCashFlow += t.IsDeduct ? -a : a;
    }
    // Mirrors renderDashboard's balance so the ring agrees with the number on the card.
    const balance = summary.Income - summary.Expense - savingDeposit - summary.Investment - summary.FreeCashFlow;
    return { summary, balance };
}

function main() {
    initTilt();
    if (!supportsWebGL()) { root.classList.add('mm3d-off'); return; }
    root.classList.add('mm3d-on');
    const views = {};
    for (const [name, init] of [['bg', initBackground], ['hero', initHeroCoin], ['city', initCity], ['timeline', initTimeline]]) {
        try { views[name] = init(); } catch (e) { console.warn('[mm3d] ' + name + ' disabled', e); document.getElementById('mm3d-' + name)?.remove(); }
    }
    const apply = detail => {
        if (!detail) return;
        if (detail.page === 'dashboard-page') {
            const s = summarize(detail.cycleTrans || []);
            views.hero?.update?.(s);
            views.city?.update?.(detail);
        } else if (detail.page === 'analytics-page') {
            views.timeline?.update?.(detail);
        }
    };
    window.addEventListener('mm:render', e => apply(e.detail));
    // The app may have rendered before this module finished loading.
    if (window.__mmLastRender) apply(window.__mmLastRender);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) Object.values(views).forEach(v => v?.kick()); });
    reduceMotion.addEventListener?.('change', () => Object.values(views).forEach(v => v?.kick()));
}

main();
