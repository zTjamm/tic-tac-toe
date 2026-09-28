/**
 * Сигналы о ходе: заголовок вкладки и короткий звук.
 *
 * Игра идёт по серверу, и игрок не обязательно смотрит на страницу. Если
 * вкладка свёрнута, без заголовка он не заметит, что очередь перешла к
 * нему, и пропустит ход. А пропущенный ход - это страйк, а страйки
 * приводят к отмене матча.
 *
 * Звук сделан на WebAudio без файлов, чтобы не тащить ассеты в репозиторий
 * и не грузить их до первого клика по странице.
 */

const BASE_TITLE = 'Крестики-нолики';

let audioContext: AudioContext | null = null;
let enabled = true;

/** Браузеры запрещают звук до первого жеста пользователя. */
function unlockAudio() {
    if (audioContext) return;
    const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
        audioContext = new Ctor();
    } catch {
        audioContext = null;
    }
}

export function setSoundEnabled(on: boolean) {
    enabled = on;
}

export function isSoundEnabled() {
    return enabled;
}

/** Короткий тон. Частота и длительность задают характер сигнала. */
function blip(freq: number, ms: number, level: number) {
    if (!enabled) return;
    unlockAudio();
    const ctx = audioContext;
    if (!ctx) return;
    if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
    }
    try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const now = ctx.currentTime;
        // Плавный подъём и спад: щелчок на входе сбивает слух
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(level, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + ms / 1000 + 0.02);
    } catch {
        /* звук не критичен - молча игнорируем */
    }
}

export function playMyTurn() {
    blip(660, 140, 0.12);
}

export function playRoundEnd() {
    blip(520, 160, 0.1);
}

/**
 * Заголовок вкладки. Показываем ход по возможности, а матч - всегда:
 * вернувшись в вкладку, игрок должен понять, что он в игре.
 */
export function setTitle(state: 'menu' | 'myTurn' | 'playing' | 'finished') {
    let title = BASE_TITLE;
    if (state === 'myTurn') title = `★ ${BASE_TITLE} — ваш ход`;
    else if (state === 'playing') title = `${BASE_TITLE} — идёт матч`;
    else if (state === 'finished') title = `${BASE_TITLE} — матч окончен`;
    if (document.title !== title) document.title = title;
}
