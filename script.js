document.addEventListener('DOMContentLoaded', () => {
    // --- Константы ---
    const STORAGE_KEY = 'mangas';
    const SETTINGS_KEY = 'manhwa-settings';
    const STORAGE_LIMIT = 5 * 1024 * 1024; // Обычный лимит localStorage в браузерах
    const COVER_MAX_WIDTH = 420;
    const STALE_DAYS = 30;
    const HEATMAP_WEEKS = 26;
    const CHECK_DELAY = 350; // Пауза между запросами, чтобы не упереться в лимиты каталогов
    const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const PAGE_SOURCE = 'manhwa-tracker-page';
    const EXTENSION_SOURCE = 'manhwa-tracker-extension';
    const SHIKIMORI = 'https://shikimori.io';
    const DATA_FILE = 'manhwa-data.json';
    const BACKUP_DIR = 'backups';
    const BACKUP_KEEP = 14; // Сколько дневных копий лежит в папке
    const SYNC_KEY = 'manhwa-sync';
    const SAVE_DELAY = 400; // Серию быстрых изменений пишем в файл одним разом
    const BOT_KEY = 'manhwa-bot';
    const BOT_QUEUE = 'manhwa-bot-queue';
    const BOT_DELAY = 3000; // Серию изменений отправляем на сервер одним разом
    const BOT_POLL = 60000; // Как часто открытый трекер забирает правки других устройств
    const BOT_TIMEOUT = 20000;

    // Порядок статусов задаёт порядок цветов в диаграмме
    const STATUSES = {
        reading: 'Читаю',
        planned: 'Запланировано',
        completed: 'Завершено',
        'on-hold': 'На паузе',
        dropped: 'Брошено'
    };

    const SORTS = {
        recent: { label: 'Недавно читал', compare: (a, b) => (a.lastReadDate || '').localeCompare(b.lastReadDate || '') * -1 },
        added: { label: 'Недавно добавил', compare: (a, b) => (a.addedDate || '').localeCompare(b.addedDate || '') * -1 },
        title: { label: 'По названию', compare: (a, b) => a.title.localeCompare(b.title, 'ru') },
        rating: { label: 'По оценке', compare: (a, b) => b.rating - a.rating },
        progress: { label: 'По прогрессу', compare: (a, b) => (progressOf(b) ?? -1) - (progressOf(a) ?? -1) },
        unread: { label: 'Больше новых глав', compare: (a, b) => unreadOf(b) - unreadOf(a) }
    };

    const ACCENTS = {
        violet: { label: 'Фиолетовый', color: '#8b5cf6' },
        blue: { label: 'Синий', color: '#2f7bf6' },
        pink: { label: 'Розовый', color: '#e0408f' },
        teal: { label: 'Бирюзовый', color: '#0f9d8a' },
        amber: { label: 'Янтарный', color: '#f59e0b' }
    };

    const ROUTES = ['home', 'library', 'stats', 'games', 'settings', 'year'];

    // --- Элементы DOM ---
    const root = document.documentElement;
    const view = document.getElementById('view');
    const tabbar = document.querySelector('.tabbar');
    const tabPill = document.querySelector('.tab-pill');
    const themeIcon = document.getElementById('theme-icon');
    const bulkBar = document.getElementById('bulk-bar');
    const toasts = document.getElementById('toasts');
    const tip = document.getElementById('tip');
    const importInput = document.getElementById('import-input');

    const detailSheet = document.getElementById('detail-sheet');
    const detailBody = document.getElementById('detail-body');

    const formSheet = document.getElementById('form-sheet');
    const mangaForm = document.getElementById('manga-form');
    const formTitle = document.getElementById('form-title');
    const formSubmit = document.getElementById('form-submit');
    const fTitle = document.getElementById('f-title');
    const fAlt = document.getElementById('f-alt');
    const fStatus = document.getElementById('f-status');
    const fCurrent = document.getElementById('f-current');
    const fTotal = document.getElementById('f-total');
    const fOngoing = document.getElementById('f-ongoing');
    const fDate = document.getElementById('f-date');
    const fLink = document.getElementById('f-link');
    const fGenres = document.getElementById('f-genres');
    const fCoverFile = document.getElementById('f-cover-file');
    const coverDrop = document.getElementById('cover-drop');
    const coverPreview = document.getElementById('cover-preview');
    const coverRemove = document.getElementById('cover-remove');
    const coverHint = coverDrop.querySelector('.cover-drop-hint');
    const diskBanner = document.getElementById('disk-banner');
    const lookupResults = document.getElementById('lookup-results');
    const fDaysField = document.getElementById('f-days-field');
    const fDays = document.getElementById('f-days');

    const palette = document.getElementById('palette');
    const paletteQuery = document.getElementById('palette-query');
    const paletteResults = document.getElementById('palette-results');

    const askDialog = document.getElementById('ask');
    const askTitle = document.getElementById('ask-title');
    const askText = document.getElementById('ask-text');
    const askButtons = document.getElementById('ask-buttons');

    // Окно Telegram: initData есть только при запуске кнопкой бота
    const webApp = window.Telegram?.WebApp;
    const inTelegram = Boolean(webApp?.initData);
    const paintTelegram = (color) => {
        if (!inTelegram || !webApp.isVersionAtLeast('6.1')) return;
        webApp.setHeaderColor(color);
        webApp.setBackgroundColor(color);
        if (webApp.isVersionAtLeast('7.10')) webApp.setBottomBarColor(color);
    };

    // --- Утилиты ---
    const esc =(value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const icon = (name, extra = '') => `<svg class="icon ${extra}"><use href="#i-${name}"/></svg>`;
    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const safeLink = (url) => /^https?:\/\//i.test(url || '') ? url : '';
    const plural = (n, one, few, many) => {
        const a = Math.abs(n) % 100;
        const b = a % 10;
        if (a > 10 && a < 20) return many;
        if (b === 1) return one;
        if (b >= 2 && b <= 4) return few;
        return many;
    };
    const chaptersWord = (n) => `${n} ${plural(n, 'глава', 'главы', 'глав')}`;
    const hostOf = (url) => {
        try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
    };

    // Даты храним как локальные YYYY-MM-DD, иначе вечером UTC сдвигает день
    const toDateStr = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const parseDate = (str) => new Date(`${str}T00:00:00`);
    const todayStr = () => toDateStr(new Date());
    const daysAgo = (str) => Math.round((parseDate(todayStr()) - parseDate(str)) / 86400000);
    const shiftDate = (date, days) => {
        const copy = new Date(date);
        copy.setDate(copy.getDate() + days);
        return copy;
    };
    const formatDate = (str, options = { day: 'numeric', month: 'long', year: 'numeric' }) => {
        if (!str || Number.isNaN(parseDate(str).getTime())) return '—';
        return parseDate(str).toLocaleDateString('ru-RU', options);
    };
    const relativeDate = (str) => {
        if (!str) return 'ещё не читал';
        const days = daysAgo(str);
        if (days <= 0) return 'сегодня';
        if (days === 1) return 'вчера';
        if (days < 7) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
        return formatDate(str, { day: 'numeric', month: 'short' });
    };

    const progressOf = (m) => m.totalChapters ? clamp(Math.round((m.currentChapter / m.totalChapters) * 100), 0, 100) : null;
    const unreadOf = (m) => m.totalChapters && !m.rereading ? Math.max(0, m.totalChapters - m.currentChapter) : 0;
    const chapterText = (m) => m.totalChapters ? `${m.currentChapter} / ${m.totalChapters}` : `${m.currentChapter}`;
    const isFinished = (m) => !m.ongoing && m.totalChapters > 0 && m.currentChapter >= m.totalChapters;
    const normalizeTitle = (title) => String(title || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

    // Угол карточки: галочка выбора, кнопка +1 или ничего у дочитанного тайтла
    const cardCornerHTML = (m) => {
        if (state.selecting) return `<span class="card-check">${icon('check')}</span>`;
        if (isFinished(m)) return '';
        return `<button class="card-inc" data-action="inc" data-id="${esc(m.id)}" title="Прочитал главу" aria-label="Прочитал главу: ${esc(m.title)}">${icon('plus')}</button>`;
    };

    const hashHue = (text) => {
        let hash = 0;
        for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
        return hash;
    };
    const initials = (title) => title.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();

    // Под картинкой всегда лежит цветная заглушка: она видна, если картинки нет или она не загрузилась
    const coverHTML = (m, cls = '') => `
        <div class="cover ${cls}" style="--h:${hashHue(m.title)}">
            <span class="cover-initials">${esc(initials(m.title))}</span>
            ${m.cover ? `<img src="${esc(m.cover)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}
        </div>`;

    const barHTML = (percent) => `<span class="bar"><i style="width:${percent ?? 0}%"></i></span>`;

    // --- Данные ---
    // Приводит запись старого формата к новому и не теряет неизвестные поля
    const normalizeManga = (raw) => {
        const parsedTotal = Number.parseInt(raw.totalChapters, 10);
        const parsedCurrent = Number.parseInt(raw.currentChapter, 10);
        return {
            ...raw,
            id: String(raw.id || uid()),
            title: String(raw.title || 'Без названия'),
            altTitle: raw.altTitle || '',
            currentChapter: Number.isNaN(parsedCurrent) ? 0 : Math.max(0, parsedCurrent),
            totalChapters: parsedTotal > 0 ? parsedTotal : null,
            ongoing: raw.ongoing === true || raw.totalChapters === 'ongoing',
            status: STATUSES[raw.status] ? raw.status : 'reading',
            lastReadDate: raw.lastReadDate || '',
            addedDate: raw.addedDate || todayStr(),
            link: raw.link || '',
            genres: Array.isArray(raw.genres) ? raw.genres.filter(Boolean).map(String) : [],
            cover: raw.cover || '',
            rating: clamp(Number(raw.rating) || 0, 0, 5),
            favorite: Boolean(raw.favorite),
            notes: raw.notes || '',
            history: Array.isArray(raw.history) ? raw.history.filter((h) => h && h.date && h.count > 0) : [],
            releaseDays: Array.isArray(raw.releaseDays) ? raw.releaseDays.filter((d) => d >= 0 && d <= 6) : [],
            rereading: Boolean(raw.rereading),
            rereadDates: Array.isArray(raw.rereadDates) ? raw.rereadDates : [],
            rereadChapters: Number(raw.rereadChapters) || 0,
            // У старых завершённых тайтлов точной даты нет, ближайшая оценка — последнее чтение
            completedDate: raw.completedDate ?? (raw.status === 'completed' ? (raw.lastReadDate || '') : ''),
            shikimoriId: raw.shikimoriId || '',
            mangadexId: raw.mangadexId || '',
            remangaDir: raw.remangaDir || '',
            updatedAt: Number(raw.updatedAt) || 0
        };
    };

    const loadMangas = () => {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.map(normalizeManga) : [];
        } catch (e) {
            // Повреждённые данные не затираем: оставляем копию для ручного восстановления
            localStorage.setItem(`${STORAGE_KEY}-corrupted`, raw);
            return [];
        }
    };

    const loadSettings = () => {
        const defaults = { accent: 'violet', glass: 'full', goal: 100, name: '', view: 'grid', sort: 'recent', reverse: false, lastExport: '', autoCheck: true, lastCheck: '' };
        try {
            return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
        } catch (e) {
            return defaults;
        }
    };

    const state = {
        mangas: loadMangas(),
        settings: loadSettings(),
        theme: localStorage.getItem('theme') || 'dark',
        route: 'home',
        filter: { status: 'all', search: '', genre: '', favorites: false, unread: false },
        selecting: false,
        selected: new Set(),
        detailId: null,
        detailKicker: '',
        editingId: null,
        formCover: '',
        formStatus: 'reading',
        formDays: [],
        formCatalog: {},
        checking: false,
        extension: false,
        reviewYear: new Date().getFullYear(),
        paletteIndex: 0,
        paletteItems: []
    };

    const findManga = (id) => state.mangas.find((m) => m.id === id);
    const cloneMangas = () => state.mangas.map((m) => ({
        ...m,
        genres: [...m.genres],
        history: m.history.map((h) => ({ ...h })),
        releaseDays: [...m.releaseDays],
        rereadDates: [...m.rereadDates]
    }));
    const saveSettings = () => {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
        markDirty();
    };

    const writeCache = () => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state.mangas));
            return true;
        } catch (e) {
            return false;
        }
    };

    // С подключённой папкой localStorage только кэш, его переполнение уже не ошибка
    const persist = () => {
        stampTitles();
        disk.cached = writeCache();
        if (!disk.cached && !disk.dir) {
            toast('Хранилище заполнено. Подключи папку в настройках или удали лишние обложки.');
            return false;
        }
        sendIndexToExtension();
        markDirty();
        markBotDirty();
        return true;
    };

    // Все изменения коллекции идут здесь: сохранение, откат при ошибке, отмена в уведомлении
    const commit = (mutate, { message, undo = false } = {}) => {
        const snapshot = cloneMangas();
        const result = mutate();
        state.mangas.forEach((m) => {
            if (m.status === 'completed' && !m.completedDate) m.completedDate = todayStr();
            if (m.status !== 'completed') m.completedDate = '';
        });
        if (!persist()) {
            state.mangas = snapshot;
            return false;
        }
        render();
        const text = typeof message === 'function' ? message(result) : message;
        if (text) {
            toast(text, undo ? () => {
                state.mangas = snapshot;
                persist();
                render();
            } : null);
        }
        return result;
    };

    // Журнал чтения: сколько глав прочитано по дням
    const logChapters = (m, delta) => {
        const today = todayStr();
        const entry = m.history.find((h) => h.date === today);
        if (entry) entry.count += delta;
        else if (delta > 0) m.history.push({ date: today, count: delta });
        m.history = m.history.filter((h) => h.count > 0);
    };

    const stepChapter = (m, delta) => {
        const limit = !m.ongoing && m.totalChapters ? m.totalChapters : Infinity;
        const next = clamp(m.currentChapter + delta, 0, limit);
        const applied = next - m.currentChapter;
        if (!applied) return 0;
        m.currentChapter = next;
        logChapters(m, applied);
        if (applied > 0) {
            m.lastReadDate = todayStr();
            if (m.ongoing && m.totalChapters && next > m.totalChapters) m.totalChapters = next;
            if (['planned', 'on-hold', 'dropped'].includes(m.status)) m.status = 'reading';
            if (!m.ongoing && m.totalChapters && next >= m.totalChapters) {
                m.status = 'completed';
                if (m.rereading) finishReread(m);
            }
        }
        return applied;
    };

    // Перечитывание: прочитанное уходит в общий счётчик, глава начинается заново
    const startReread = (m) => {
        m.rereadChapters += m.currentChapter;
        m.currentChapter = 0;
        m.rereading = true;
        m.status = 'reading';
    };

    const finishReread = (m) => {
        m.rereading = false;
        m.rereadDates.push(todayStr());
    };

    const readChapters = (id, delta) => {
        const m = findManga(id);
        if (!m) return;
        const wasCompleted = m.status === 'completed';
        commit(() => stepChapter(m, delta), {
            undo: true,
            message: (applied) => {
                if (!applied) return m.totalChapters ? 'Это уже последняя глава' : '';
                if (m.status === 'completed' && !wasCompleted) return `«${m.title}» завершена`;
                return `${m.title}: глава ${m.currentChapter}`;
            }
        });
    };

    // --- Подсчёты ---
    const activityByDay = () => {
        const days = new Map();
        state.mangas.forEach((m) => m.history.forEach((h) => days.set(h.date, (days.get(h.date) || 0) + h.count)));
        return days;
    };

    const currentStreak = (days) => {
        let cursor = new Date();
        if (!days.has(toDateStr(cursor))) cursor = shiftDate(cursor, -1);
        let streak = 0;
        while (days.has(toDateStr(cursor))) {
            streak += 1;
            cursor = shiftDate(cursor, -1);
        }
        return streak;
    };

    const bestStreak = (days) => {
        const sorted = [...days.keys()].sort();
        let best = 0;
        let run = 0;
        sorted.forEach((date, i) => {
            const follows = i > 0 && toDateStr(shiftDate(parseDate(sorted[i - 1]), 1)) === date;
            run = follows ? run + 1 : 1;
            best = Math.max(best, run);
        });
        return best;
    };

    const chaptersInMonth = (days, year, month) => {
        const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
        let total = 0;
        days.forEach((count, date) => { if (date.startsWith(prefix)) total += count; });
        return total;
    };

    const genreCounts = () => {
        const counts = new Map();
        state.mangas.forEach((m) => m.genres.forEach((g) => counts.set(g, (counts.get(g) || 0) + 1)));
        return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
    };

    const totalChaptersRead = () => state.mangas.reduce((sum, m) => sum + m.currentChapter + m.rereadChapters, 0);

    const storageUsed = () => {
        let chars = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            chars += key.length + (localStorage.getItem(key) || '').length;
        }
        return chars * 2; // localStorage считает по 2 байта на символ
    };

    // --- Главная ---
    const greeting = () => {
        const hour = new Date().getHours();
        const base = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
        return state.settings.name ? `${base}, ${state.settings.name}` : base;
    };

    const emptyCollectionHTML = () => `
        <section class="empty glass">
            <h2>Коллекция пока пуста</h2>
            <p>Добавь первую манхву или загрузи файл экспорта, если он у тебя есть.</p>
            <div class="empty-actions">
                <button class="btn btn-primary" data-action="add">${icon('plus')}Добавить</button>
                <button class="btn" data-action="import">${icon('upload')}Импорт</button>
                ${disk.supported && !disk.dir ? `<button class="btn" data-action="disk-connect">${icon('folder')}Открыть папку с данными</button>` : ''}
            </div>
        </section>`;

    const continueCardHTML = (m) => `
        <article class="continue glass">
            <button data-action="open" data-id="${esc(m.id)}" aria-label="Открыть ${esc(m.title)}">${coverHTML(m)}</button>
            <div>
                <button class="continue-title" data-action="open" data-id="${esc(m.id)}">${esc(m.title)}</button>
                <div class="continue-meta">Глава ${chapterText(m)} · ${relativeDate(m.lastReadDate)}</div>
                ${m.totalChapters ? barHTML(progressOf(m)) : ''}
                <div class="continue-foot">
                    <button class="btn btn-primary" data-action="inc" data-id="${esc(m.id)}">${icon('plus')}Глава</button>
                    ${safeLink(m.link) ? `<a class="btn" href="${esc(m.link)}" target="_blank" rel="noopener noreferrer">${icon('link')}Читать</a>` : ''}
                </div>
            </div>
        </article>`;

    // Понедельник — 0, как в releaseDays
    const weekdayIndex = (date = new Date()) => (date.getDay() + 6) % 7;

    const scheduleHTML = () => {
        const scheduled = state.mangas.filter((m) => m.ongoing && m.releaseDays.length && !['dropped', 'completed'].includes(m.status));
        if (!scheduled.length) {
            return `
            <section class="section panel glass">
                <h2 class="panel-title">Расписание выхода</h2>
                <p class="panel-note">Открой онгоинг, нажми «Редактировать» и отметь дни выхода. Здесь появится неделя с твоими тайтлами.</p>
            </section>`;
        }
        const today = weekdayIndex();
        return `
            <section class="section">
                <div class="section-head"><h2 class="section-title">Расписание выхода</h2></div>
                <div class="week">
                    ${WEEKDAYS.map((label, day) => {
                        const items = scheduled.filter((m) => m.releaseDays.includes(day));
                        return `
                        <div class="week-day ${day === today ? 'today' : ''}">
                            <div class="week-label">${day === today ? 'Сегодня' : label}</div>
                            ${items.length ? items.map((m) => `
                                <button class="week-item" data-action="open" data-id="${esc(m.id)}">
                                    ${esc(m.title)}${unreadOf(m) ? ` <b>+${unreadOf(m)}</b>` : ''}
                                </button>`).join('') : '<div class="week-empty">—</div>'}
                        </div>`;
                    }).join('')}
                </div>
            </section>`;
    };

    const renderHome = () => {
        const { mangas, settings } = state;
        const days = activityByDay();
        const now = new Date();
        const today = days.get(todayStr()) || 0;
        const streak = currentStreak(days);
        const month = chaptersInMonth(days, now.getFullYear(), now.getMonth());
        const goalPercent = settings.goal > 0 ? clamp(Math.round((month / settings.goal) * 100), 0, 100) : 0;
        const reading = mangas.filter((m) => m.status === 'reading');
        const unread = mangas.filter((m) => ['reading', 'on-hold'].includes(m.status)).reduce((sum, m) => sum + unreadOf(m), 0);
        const continueList = [...reading].sort(SORTS.recent.compare).slice(0, 12);
        const stale = mangas
            .filter((m) => ['reading', 'on-hold'].includes(m.status) && m.lastReadDate && daysAgo(m.lastReadDate) >= STALE_DAYS)
            .sort((a, b) => a.lastReadDate.localeCompare(b.lastReadDate))
            .slice(0, 4);
        const summary = today > 0
            ? `Сегодня ${plural(today, 'прочитана', 'прочитаны', 'прочитано')} ${chaptersWord(today)}`
            : 'Сегодня пока без глав';

        view.innerHTML = `
            <div class="page-head">
                <h1 class="page-title">${esc(greeting())}</h1>
                <p class="page-sub">${summary}</p>
            </div>
            ${mangas.length === 0 ? emptyCollectionHTML() : `
            <section class="tiles">
                <div class="tile goal glass">
                    <div>
                        <div class="tile-label">Цель на месяц</div>
                        <div class="tile-value">${month}<small> / ${settings.goal}</small></div>
                    </div>
                    <svg class="ring" viewBox="0 0 100 100" role="img" aria-label="Выполнено ${goalPercent}%">
                        <circle class="track" cx="50" cy="50" r="42" pathLength="100"/>
                        <circle class="value" cx="50" cy="50" r="42" pathLength="100" stroke-dasharray="${goalPercent} 100"/>
                    </svg>
                </div>
                <div class="tile glass">
                    <div class="tile-label">${icon('flame')}Серия</div>
                    <div class="tile-value">${streak}<small> ${plural(streak, 'день', 'дня', 'дней')}</small></div>
                    <div class="tile-note">Рекорд: ${bestStreak(days)}</div>
                </div>
                <div class="tile glass">
                    <div class="tile-label">${icon('book')}Читаю сейчас</div>
                    <div class="tile-value">${reading.length}</div>
                    <div class="tile-note">Всего в коллекции: ${mangas.length}</div>
                </div>
                <div class="tile glass">
                    <div class="tile-label">${icon('bell')}Новые главы</div>
                    <div class="tile-value">${unread}</div>
                    <button class="link-btn" data-action="check-new" ${state.checking ? 'disabled' : ''}>${state.checking ? 'Проверяю...' : 'Проверить сейчас'}</button>
                </div>
            </section>
            ${continueList.length ? `
            <section class="section">
                <div class="section-head">
                    <h2 class="section-title">Продолжить чтение</h2>
                    <a class="section-link" href="#library">Вся библиотека</a>
                </div>
                <div class="rail">${continueList.map(continueCardHTML).join('')}</div>
            </section>` : ''}
            ${scheduleHTML()}
            <section class="section split">
                <div class="panel glass">
                    <h2 class="panel-title">Что почитать?</h2>
                    <p class="panel-note">Случайный тайтл из запланированного, начатого и отложенного.</p>
                    <div class="section"><button class="btn btn-primary" data-action="random">${icon('dice')}Выбрать за меня</button></div>
                </div>
                <div class="panel glass">
                    <h2 class="panel-title">Давно не открывал</h2>
                    ${stale.length ? stale.map((m) => `
                        <button class="stale-row" data-action="open" data-id="${esc(m.id)}">
                            ${coverHTML(m)}
                            <span class="stale-text"><b>${esc(m.title)}</b><small>${daysAgo(m.lastReadDate)} ${plural(daysAgo(m.lastReadDate), 'день', 'дня', 'дней')} без чтения</small></span>
                        </button>`).join('') : `<p class="panel-note">Всё начатое читалось за последние ${STALE_DAYS} дней.</p>`}
                </div>
            </section>`}
        `;
    };

    // --- Библиотека ---
    const filteredMangas = () => {
        const { status, search, genre, favorites, unread } = state.filter;
        const query = search.trim().toLowerCase();
        const list = state.mangas.filter((m) => {
            if (status !== 'all' && m.status !== status) return false;
            if (favorites && !m.favorite) return false;
            if (unread && unreadOf(m) === 0) return false;
            if (genre && !m.genres.includes(genre)) return false;
            if (!query) return true;
            return [m.title, m.altTitle, m.notes, ...m.genres].join(' ').toLowerCase().includes(query);
        });
        list.sort(SORTS[state.settings.sort].compare);
        return state.settings.reverse ? list.reverse() : list;
    };

    const cardHTML = (m) => {
        const selected = state.selected.has(m.id);
        const unread = unreadOf(m);
        const showNew = unread > 0 && ['reading', 'on-hold'].includes(m.status);
        return `
        <article class="card ${selected ? 'selected' : ''}">
            ${coverHTML(m)}
            ${showNew
                ? `<span class="badge badge-new">+${unread}</span>`
                : `<span class="badge st-${m.status}"><span class="dot"></span><span class="badge-text">${m.rereading ? 'Перечитываю' : STATUSES[m.status]}</span></span>`}
            <div class="plate">
                <h3>${esc(m.title)}</h3>
                <div class="plate-meta">
                    <span>Гл. ${chapterText(m)}</span>
                    ${m.favorite ? `<span class="fav-mark">${icon('heart', 'filled')}</span>` : ''}
                </div>
                ${m.totalChapters ? barHTML(progressOf(m)) : ''}
            </div>
            <button class="card-open" data-action="open" data-id="${esc(m.id)}" aria-label="${esc(m.title)}"></button>
            ${cardCornerHTML(m)}
        </article>`;
    };

    const rowHTML = (m) => {
        const selected = state.selected.has(m.id);
        return `
        <article class="row ${selected ? 'selected' : ''}">
            ${coverHTML(m)}
            <div>
                <div class="row-title">${esc(m.title)}</div>
                <div class="row-meta st-${m.status}"><span class="dot"></span>${STATUSES[m.status]} · ${relativeDate(m.lastReadDate)}${m.rating ? ` · ${m.rating}★` : ''}</div>
            </div>
            <div class="row-progress"><span>Глава ${chapterText(m)}</span>${m.totalChapters ? barHTML(progressOf(m)) : ''}</div>
            <button class="card-open" data-action="open" data-id="${esc(m.id)}" aria-label="${esc(m.title)}"></button>
            ${cardCornerHTML(m)}
        </article>`;
    };

    const paintLibrary = () => {
        const filters = document.getElementById('lib-filters');
        const results = document.getElementById('lib-results');
        if (!filters || !results) return;
        const { status, genre, favorites, unread } = state.filter;
        const counts = { all: state.mangas.length };
        Object.keys(STATUSES).forEach((key) => { counts[key] = state.mangas.filter((m) => m.status === key).length; });

        const genres = genreCounts().slice(0, 14);
        filters.innerHTML = `
            <div class="chips chips-scroll">
                <button class="chip ${status === 'all' ? 'active' : ''}" data-action="filter-status" data-value="all">Все <span class="count">${counts.all}</span></button>
                ${Object.entries(STATUSES).map(([key, label]) => `
                    <button class="chip st-${key} ${status === key ? 'active' : ''}" data-action="filter-status" data-value="${key}"><span class="dot"></span>${label} <span class="count">${counts[key]}</span></button>`).join('')}
            </div>
            <div class="chips chips-scroll">
                <button class="chip small ${favorites ? 'active' : ''}" data-action="filter-favorites">${icon('heart')}Избранное</button>
                <button class="chip small ${unread ? 'active' : ''}" data-action="filter-unread">${icon('bell')}Есть новые главы</button>
                ${genres.map(([name]) => `<button class="chip small ${genre === name ? 'active' : ''}" data-action="filter-genre" data-value="${esc(name)}">${esc(name)}</button>`).join('')}
            </div>`;

        const list = filteredMangas();
        if (state.mangas.length === 0) {
            results.innerHTML = emptyCollectionHTML();
        } else if (list.length === 0) {
            results.innerHTML = `<section class="empty glass"><h2>Ничего не нашлось</h2><p>Попробуй изменить запрос или сбросить фильтры.</p><div class="empty-actions"><button class="btn" data-action="reset-filters">Сбросить</button></div></section>`;
        } else if (state.settings.view === 'list') {
            results.innerHTML = `<div class="list">${list.map(rowHTML).join('')}</div>`;
        } else {
            results.innerHTML = `<div class="grid">${list.map(cardHTML).join('')}</div>`;
        }
        paintBulkBar();
    };

    const renderLibrary = () => {
        const { settings } = state;
        view.innerHTML = `
            <div class="page-head"><h1 class="page-title">Библиотека</h1></div>
            <div class="toolbar glass">
                <label class="search">
                    ${icon('search')}
                    <input id="lib-search" type="search" placeholder="Название, жанр или заметка" aria-label="Поиск по библиотеке" value="${esc(state.filter.search)}">
                </label>
                <select id="lib-sort" aria-label="Сортировка">
                    ${Object.entries(SORTS).map(([key, sort]) => `<option value="${key}" ${settings.sort === key ? 'selected' : ''}>${sort.label}</option>`).join('')}
                </select>
                <button class="round-btn ${settings.reverse ? 'active' : ''}" data-action="toggle-reverse" title="Обратный порядок" aria-label="Обратный порядок">${icon('sort')}</button>
                <button class="round-btn" data-action="toggle-layout" title="${settings.view === 'grid' ? 'Показать списком' : 'Показать плитками'}" aria-label="Сменить вид">${icon(settings.view === 'grid' ? 'list' : 'grid')}</button>
                <button class="round-btn ${state.selecting ? 'active' : ''}" data-action="toggle-select" title="Выбрать несколько" aria-label="Выбрать несколько">${icon('select')}</button>
            </div>
            <div id="lib-filters" class="filters"></div>
            <div id="lib-results"></div>
        `;
        paintLibrary();
    };

    const paintBulkBar = () => {
        const show = state.selecting && state.route === 'library';
        bulkBar.hidden = !show;
        if (!show) return;
        const count = state.selected.size;
        bulkBar.innerHTML = `
            <span class="bulk-count">Выбрано: ${count}</span>
            <button class="btn" data-action="select-all">Все</button>
            <select id="bulk-status" aria-label="Сменить статус" ${count ? '' : 'disabled'}>
                <option value="">Сменить статус</option>
                ${Object.entries(STATUSES).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}
            </select>
            <button class="btn btn-danger" data-action="bulk-delete" ${count ? '' : 'disabled'}>${icon('trash')}Удалить</button>
            <button class="round-btn" data-action="toggle-select" aria-label="Закрыть выбор">${icon('close')}</button>`;
    };

    // --- Статистика ---
    const heatmapHTML = (days) => {
        const today = parseDate(todayStr());
        const weekday = (today.getDay() + 6) % 7; // Понедельник первый
        const start = shiftDate(today, -(HEATMAP_WEEKS - 1) * 7 - weekday);
        const level = (n) => (n === 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 10 ? 3 : 4);
        const cells = [];
        const months = [];
        let lastMonth = -1;

        for (let week = 0; week < HEATMAP_WEEKS; week++) {
            const monday = shiftDate(start, week * 7);
            const showMonth = monday.getMonth() !== lastMonth;
            lastMonth = monday.getMonth();
            months.push(`<span>${showMonth ? esc(monday.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')) : ''}</span>`);
            for (let day = 0; day < 7; day++) {
                const date = shiftDate(monday, day);
                if (date > today) {
                    cells.push('<i style="visibility:hidden"></i>');
                    continue;
                }
                const key = toDateStr(date);
                const count = days.get(key) || 0;
                const tipText = `${formatDate(key, { day: 'numeric', month: 'long' })}: ${count ? chaptersWord(count) : 'без чтения'}`;
                cells.push(`<i data-l="${level(count)}" data-tip="${esc(tipText)}" class="${key === todayStr() ? 'today' : ''}"></i>`);
            }
        }
        return `
            <div class="heat-months">${months.join('')}</div>
            <div class="heat" role="img" aria-label="Активность чтения за ${HEATMAP_WEEKS} недель">${cells.join('')}</div>
            <div class="heat-legend"><span>Меньше</span><i></i><i data-l="1"></i><i data-l="2"></i><i data-l="3"></i><i data-l="4"></i><span>Больше</span></div>`;
    };

    const monthBar = (days, date) => ({
        label: date.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', ''),
        full: date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }),
        value: chaptersInMonth(days, date.getFullYear(), date.getMonth())
    });

    const monthsHTML = (days) => {
        const now = new Date();
        const data = [];
        for (let i = 5; i >= 0; i--) data.push(monthBar(days, new Date(now.getFullYear(), now.getMonth() - i, 1)));
        return monthBarsHTML(data);
    };

    const monthBarsHTML = (data, cls = '') => {
        const max = Math.max(1, ...data.map((d) => d.value));
        return `<div class="months ${cls}">${data.map((d) => `
            <div class="month" data-tip="${esc(d.full)}: ${esc(chaptersWord(d.value))}">
                <b>${d.value || ''}</b>
                <div class="month-track"><i style="height:${(d.value / max) * 100}%"></i></div>
                <span>${esc(d.label)}</span>
            </div>`).join('')}</div>`;
    };

    const achievementsHTML = (days) => {
        const { mangas } = state;
        const totalRead = totalChaptersRead();
        const rereads = mangas.reduce((sum, m) => sum + m.rereadDates.length, 0);
        const completed = mangas.filter((m) => m.status === 'completed').length;
        const rated = mangas.filter((m) => m.rating > 0).length;
        const best = bestStreak(days);
        const list = [
            ['Первый шаг', '1 тайтл в коллекции', mangas.length, 1, 'book'],
            ['Коллекционер', '25 тайтлов', mangas.length, 25, 'library'],
            ['Сотня', '100 глав', totalRead, 100, 'check'],
            ['Тысячник', '1000 глав', totalRead, 1000, 'sparkles'],
            ['Финишёр', '5 завершённых', completed, 5, 'check'],
            ['Неделя подряд', 'Серия 7 дней', best, 7, 'flame'],
            ['Месяц подряд', 'Серия 30 дней', best, 30, 'flame'],
            ['Критик', '10 оценок', rated, 10, 'star'],
            ['Второй круг', '1 перечитывание', rereads, 1, 'repeat']
        ];
        return `<div class="achievements">${list.map(([title, note, value, target, name]) => `
            <div class="achievement ${value >= target ? 'done' : ''}">
                <span class="achievement-icon">${icon(name)}</span>
                <div><b>${title}</b><small>${value >= target ? note : `${note} · ${value}/${target}`}</small></div>
            </div>`).join('')}</div>`;
    };

    const renderStats = () => {
        const { mangas } = state;
        const days = activityByDay();
        const totalRead = totalChaptersRead();
        const rated = mangas.filter((m) => m.rating > 0);
        const average = rated.length ? (rated.reduce((sum, m) => sum + m.rating, 0) / rated.length).toFixed(1).replace('.', ',') : '—';
        const counts = Object.keys(STATUSES).map((key) => [key, mangas.filter((m) => m.status === key).length]);
        const genres = genreCounts().slice(0, 8);
        const maxGenre = genres.length ? genres[0][1] : 1;

        view.innerHTML = `
            <div class="page-head page-head-row">
                <h1 class="page-title">Статистика</h1>
                <a class="btn" href="#year">${icon('sparkles')}Итоги года</a>
            </div>
            <section class="tiles">
                <div class="tile glass"><div class="tile-label">Всего глав</div><div class="tile-value">${totalRead.toLocaleString('ru-RU')}</div></div>
                <div class="tile glass"><div class="tile-label">Завершено</div><div class="tile-value">${mangas.filter((m) => m.status === 'completed').length}</div></div>
                <div class="tile glass"><div class="tile-label">Средняя оценка</div><div class="tile-value">${average}</div></div>
                <div class="tile glass"><div class="tile-label">Лучшая серия</div><div class="tile-value">${bestStreak(days)}<small> ${plural(bestStreak(days), 'день', 'дня', 'дней')}</small></div></div>
            </section>
            <section class="section panel glass">
                <h2 class="panel-title">Активность чтения</h2>
                ${heatmapHTML(days)}
            </section>
            <section class="section split">
                <div class="panel glass">
                    <h2 class="panel-title">Коллекция по статусам</h2>
                    ${mangas.length ? `<div class="stack" role="img" aria-label="Распределение по статусам">${counts.filter(([, n]) => n > 0).map(([key, n]) => `<i class="st-${key}" style="flex:${n}" data-tip="${STATUSES[key]}: ${n}"></i>`).join('')}</div>` : ''}
                    <div class="legend">${counts.map(([key, n]) => `<div class="st-${key}"><span class="dot"></span>${STATUSES[key]}<b>${n}</b></div>`).join('')}</div>
                </div>
                <div class="panel glass">
                    <h2 class="panel-title">Главы по месяцам</h2>
                    ${monthsHTML(days)}
                </div>
            </section>
            <section class="section split">
                <div class="panel glass">
                    <h2 class="panel-title">Любимые жанры</h2>
                    ${genres.length ? `<div class="hbars">${genres.map(([name, n]) => `
                        <div class="hbar" data-tip="${esc(name)}: ${n}"><span>${esc(name)}</span><div><em style="width:${Math.max(3, (n / maxGenre) * 100)}%"></em></div><b>${n}</b></div>`).join('')}</div>` : '<p class="panel-note">Жанры появятся, когда добавишь их к тайтлам.</p>'}
                </div>
                <div class="panel glass">
                    <h2 class="panel-title">Достижения</h2>
                    ${achievementsHTML(days)}
                </div>
            </section>
        `;
    };

    // --- Итоги года ---
    const reviewYears = () => {
        const years = new Set([new Date().getFullYear()]);
        const add = (date) => { if (date) years.add(Number(date.slice(0, 4))); };
        state.mangas.forEach((m) => {
            m.history.forEach((h) => add(h.date));
            add(m.completedDate);
            add(m.addedDate);
        });
        return [...years].filter(Boolean).sort((a, b) => b - a);
    };

    const yearSummary = (year) => {
        const prefix = `${year}-`;
        const days = new Map([...activityByDay()].filter(([date]) => date.startsWith(prefix)));
        const chapters = [...days.values()].reduce((sum, n) => sum + n, 0);
        const titles = state.mangas
            .map((m) => ({ manga: m, chapters: m.history.filter((h) => h.date.startsWith(prefix)).reduce((sum, h) => sum + h.count, 0) }))
            .filter((item) => item.chapters > 0)
            .sort((a, b) => b.chapters - a.chapters);
        const genres = new Map();
        titles.forEach(({ manga, chapters: count }) => manga.genres.forEach((g) => genres.set(g, (genres.get(g) || 0) + count)));
        const months = Array.from({ length: 12 }, (_, month) => monthBar(days, new Date(year, month, 1)));
        return {
            days,
            chapters,
            titles,
            months,
            topGenre: [...genres.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '—',
            bestMonth: [...months].sort((a, b) => b.value - a.value)[0],
            streak: bestStreak(days),
            finished: state.mangas.filter((m) => m.completedDate.startsWith(prefix)),
            added: state.mangas.filter((m) => m.addedDate.startsWith(prefix)).length,
            rereads: state.mangas.reduce((sum, m) => sum + m.rereadDates.filter((d) => d.startsWith(prefix)).length, 0)
        };
    };

    const renderYear = () => {
        const year = state.reviewYear;
        const s = yearSummary(year);
        const yearChips = reviewYears().map((y) => `<button class="chip ${y === year ? 'active' : ''}" data-action="set-year" data-value="${y}">${y}</button>`).join('');
        const hasActivity = s.chapters > 0 || s.finished.length > 0;

        view.innerHTML = `
            <div class="page-head">
                <h1 class="page-title">Итоги ${year}</h1>
                <p class="page-sub">Считаются главы, отмеченные в трекере с момента начала учёта.</p>
                <div class="chips year-chips">${yearChips}</div>
            </div>
            ${!hasActivity ? `<section class="empty glass"><h2>За этот год пока пусто</h2><p>Отмечай прочитанные главы, и здесь соберутся твои итоги.</p></section>` : `
            <section class="year-hero glass">
                <div class="year-number">${s.chapters.toLocaleString('ru-RU')}</div>
                <div class="year-caption">${plural(s.chapters, 'глава прочитана', 'главы прочитаны', 'глав прочитано')} за ${s.days.size} ${plural(s.days.size, 'день', 'дня', 'дней')} чтения</div>
            </section>
            <section class="section tiles">
                <div class="tile glass"><div class="tile-label">Лучший месяц</div><div class="tile-value year-word">${esc(s.bestMonth.value ? s.bestMonth.label : '—')}</div><div class="tile-note">${s.bestMonth.value ? chaptersWord(s.bestMonth.value) : ''}</div></div>
                <div class="tile glass"><div class="tile-label">Любимый жанр</div><div class="tile-value year-word">${esc(s.topGenre)}</div></div>
                <div class="tile glass"><div class="tile-label">Серия</div><div class="tile-value">${s.streak}<small> ${plural(s.streak, 'день', 'дня', 'дней')}</small></div></div>
                <div class="tile glass"><div class="tile-label">Завершено и перечитано</div><div class="tile-value">${s.finished.length}<small> + ${s.rereads}</small></div><div class="tile-note">Новых в коллекции: ${s.added}</div></div>
            </section>
            <section class="section split">
                <div class="panel glass">
                    <h2 class="panel-title">Больше всего читал</h2>
                    ${s.titles.length ? s.titles.slice(0, 5).map(({ manga, chapters }, i) => `
                        <button class="stale-row" data-action="open" data-id="${esc(manga.id)}">
                            <span class="year-rank">${i + 1}</span>
                            ${coverHTML(manga)}
                            <span class="stale-text"><b>${esc(manga.title)}</b><small>${chaptersWord(chapters)}</small></span>
                        </button>`).join('') : '<p class="panel-note">Истории чтения за этот год нет.</p>'}
                </div>
                <div class="panel glass">
                    <h2 class="panel-title">Главы по месяцам</h2>
                    ${monthBarsHTML(s.months, 'months-year')}
                </div>
            </section>
            ${s.finished.length ? `
            <section class="section panel glass">
                <h2 class="panel-title">Дочитано за год</h2>
                <div class="year-covers">${s.finished.map((m) => `
                    <button data-action="open" data-id="${esc(m.id)}" data-tip="${esc(m.title)}" aria-label="${esc(m.title)}">${coverHTML(m)}</button>`).join('')}</div>
            </section>` : ''}`}
        `;
    };

    // --- Настройки ---
    const renderSettings = () => {
        const { settings } = state;
        const used = storageUsed();
        const usedPercent = clamp(Math.round((used / STORAGE_LIMIT) * 100), 0, 100);
        const seg = (group, value, label, current) => `<button class="chip small ${current === value ? 'active' : ''}" data-action="${group}" data-value="${value}">${label}</button>`;

        view.innerHTML = `
            <div class="page-head"><h1 class="page-title">Настройки</h1></div>
            <div class="settings">
                <section class="panel glass">
                    <h2 class="panel-title">Оформление</h2>
                    <div class="setting"><div class="setting-label">Тема</div><div class="chips">
                        ${seg('set-theme', 'dark', 'Тёмная', state.theme)}${seg('set-theme', 'light', 'Светлая', state.theme)}${seg('set-theme', 'auto', 'Авто', state.theme)}
                    </div></div>
                    <div class="setting"><div class="setting-label">Акцент</div><div class="swatches">
                        ${Object.entries(ACCENTS).map(([key, a]) => `<button class="swatch ${settings.accent === key ? 'active' : ''}" style="--sw:${a.color}" data-action="set-accent" data-value="${key}" title="${a.label}" aria-label="${a.label}"></button>`).join('')}
                    </div></div>
                    <div class="setting"><div class="setting-label">Стекло<small>Плотный режим легче для слабых устройств</small></div><div class="chips">
                        ${seg('set-glass', 'full', 'Жидкое', settings.glass)}${seg('set-glass', 'solid', 'Плотное', settings.glass)}
                    </div></div>
                </section>

                <section class="panel glass">
                    <h2 class="panel-title">Обо мне</h2>
                    <div class="setting"><label class="setting-label" for="set-name">Имя<small>Для приветствия на главной</small></label><input id="set-name" type="text" value="${esc(settings.name)}" autocomplete="off"></div>
                    <div class="setting"><label class="setting-label" for="set-goal">Цель на месяц<small>Сколько глав хочу прочитать</small></label><input id="set-goal" type="number" min="1" value="${settings.goal}"></div>
                </section>

                <section class="panel glass">
                    <h2 class="panel-title">Данные</h2>
                    ${disk.dir ? `
                    <p class="panel-note"><span id="disk-status">${esc(diskStatusText())}</span></p>
                    <p class="panel-note">Коллекция лежит в файле ${DATA_FILE}, копии за ${BACKUP_KEEP} дней в папке ${BACKUP_DIR}. Браузер хранит только кэш.</p>` : `
                    <div class="storage">
                        <div class="storage-text"><span>Занято в браузере</span><span>${(used / 1048576).toFixed(1).replace('.', ',')} из 5 МБ</span></div>
                        ${barHTML(usedPercent)}
                    </div>
                    <p class="panel-note">${disk.supported ? 'Сейчас данные только в браузере. Выбери папку, и они будут лежать в обычном файле без лимита в 5 МБ.' : telegram.url ? 'На этом устройстве данные лежат в браузере, а копия хранится на сервере бота.' : 'Здесь данные хранятся только в браузере. Подключи бота ниже, и коллекция будет общей для всех устройств.'} Последний экспорт: ${settings.lastExport ? formatDate(settings.lastExport) : 'ещё не делал'}.</p>`}
                    <div class="section button-row">
                        ${disk.dir ? `<button class="btn" data-action="disk-connect">${icon('folder')}Сменить папку</button><button class="btn" data-action="disk-disconnect">${icon('close')}Отключить папку</button>` : disk.supported ? `<button class="btn btn-primary" data-action="disk-connect">${icon('folder')}Выбрать папку</button>` : ''}
                        <button class="btn" data-action="export-json">${icon('download')}Экспорт JSON</button>
                        <button class="btn" data-action="export-csv">${icon('download')}Экспорт CSV</button>
                        <button class="btn" data-action="import">${icon('upload')}Импорт</button>
                        <button class="btn btn-danger" data-action="wipe">${icon('trash')}Очистить всё</button>
                    </div>
                </section>

                <section class="panel glass">
                    <h2 class="panel-title">Новые главы и расширение</h2>
                    <label class="switch-row">
                        <span>Проверять раз в день<small>Только онгоинги, при открытии трекера</small></span>
                        <input id="set-autocheck" type="checkbox" class="switch" ${settings.autoCheck ? 'checked' : ''}>
                    </label>
                    <p class="panel-note">Расширение: ${state.extension ? 'подключено' : 'не найдено'}. Последняя проверка: ${settings.lastCheck ? formatDate(settings.lastCheck) : 'ещё не было'}.</p>
                    <div class="section button-row">
                        <button class="btn" data-action="check-new" ${state.checking ? 'disabled' : ''}>${icon('bell')}${state.checking ? 'Проверяю...' : 'Проверить сейчас'}</button>
                    </div>
                </section>

                <section class="panel glass">
                    <h2 class="panel-title">Telegram-бот и устройства</h2>
                    <p class="panel-note"><span id="bot-status">${esc(botStatusText())}</span></p>
                    ${telegram.url ? `
                    <div class="section button-row">
                        <button class="btn" data-action="bot-sync">${icon('bell')}Синхронизировать</button>
                        <button class="btn" data-action="bot-code">${icon('download')}Код для телефона</button>
                        <button class="btn" data-action="bot-disconnect">${icon('close')}Отключить</button>
                    </div>` : `
                    <div class="setting"><label class="setting-label" for="bot-url">Адрес сервера или код<small>Домен на Amvera или код с другого устройства</small></label><input id="bot-url" type="text" placeholder="https://..." autocomplete="off" autocapitalize="off" spellcheck="false"></div>
                    <div class="setting"><label class="setting-label" for="bot-key">Ключ<small>Значение SYNC_KEY, с кодом не нужен</small></label><input id="bot-key" type="password" autocomplete="off"></div>
                    <div class="section button-row"><button class="btn btn-primary" data-action="bot-connect">${icon('plus')}Подключить</button></div>`}
                </section>

                <section class="panel glass">
                    <h2 class="panel-title">Быстрое добавление списком</h2>
                    <div class="field">
                        <label for="quick-list">Один тайтл на строку, попадут в «Запланировано»</label>
                        <textarea id="quick-list" placeholder="Solo Leveling&#10;Tower of God&#10;Omniscient Reader"></textarea>
                    </div>
                    <button class="btn" data-action="quick-add">${icon('plus')}Добавить всё</button>
                </section>

                <section class="panel glass">
                    <h2 class="panel-title">Горячие клавиши</h2>
                    <div class="keys">
                        <div>Поиск и команды <kbd>Ctrl K</kbd></div>
                        <div>Новая манхва <kbd>N</kbd></div>
                        <div>Случайный тайтл <kbd>R</kbd></div>
                        <div>Сменить тему <kbd>T</kbd></div>
                        <div>Разделы <kbd>1–5</kbd></div>
                        <div>Поиск в библиотеке <kbd>/</kbd></div>
                    </div>
                </section>
            </div>
        `;
    };

    // --- Отрисовка и маршруты ---
    const renderers = { home: renderHome, library: renderLibrary, stats: renderStats, games: () => window.Games.render(view), settings: renderSettings, year: renderYear };

    const moveTabPill = () => {
        const active = tabbar.querySelector('.tab.active');
        if (!active) return;
        tabPill.style.width = `${active.offsetWidth}px`;
        tabPill.style.transform = `translateX(${active.offsetLeft}px)`;
    };

    const render = () => {
        renderers[state.route]();
        paintBulkBar();
        if (detailSheet.open) renderDetail();
    };

    let enterTimer = 0;

    const applyRoute = () => {
        const hash = location.hash.slice(1);
        const route = ROUTES.includes(hash) ? hash : 'home';
        if (route !== 'library' && state.selecting) stopSelecting();
        if (route !== 'games') window.Games.leave();
        state.route = route;
        tabbar.querySelectorAll('.tab').forEach((tab) => {
            const active = tab.dataset.route === (route === 'year' ? 'stats' : route);
            tab.classList.toggle('active', active);
            if (active) tab.setAttribute('aria-current', 'page');
            else tab.removeAttribute('aria-current');
        });
        moveTabPill();
        render();
        view.classList.remove('entering');
        void view.offsetWidth; // Перезапуск анимации появления
        view.classList.add('entering');
        clearTimeout(enterTimer);
        enterTimer = setTimeout(() => view.classList.remove('entering'), 700); // Иначе анимация повторится при каждой перерисовке
        window.scrollTo({ top: 0 });
    };

    const stopSelecting = () => {
        state.selecting = false;
        state.selected.clear();
    };

    // --- Тема и оформление ---
    const applyTheme = () => {
        const dark = state.theme === 'auto' ? matchMedia('(prefers-color-scheme: dark)').matches : state.theme !== 'light';
        root.dataset.theme = dark ? 'dark' : 'light';
        themeIcon.setAttribute('href', dark ? '#i-moon' : '#i-sun');
        document.querySelector('meta[name="theme-color"]').content = dark ? '#0d0b16' : '#ece8f6';
        paintTelegram(dark ? '#0d0b16' : '#ece8f6');
    };

    const setTheme = (theme) => {
        state.theme = theme;
        localStorage.setItem('theme', theme);
        markDirty();
        applyTheme();
        if (state.route === 'settings') render();
    };

    // --- Уведомления, подсказки, подтверждения ---
    const toast = (message, onUndo = null) => {
        const el = document.createElement('div');
        el.className = 'toast';
        el.innerHTML = `<span>${esc(message)}</span>${onUndo ? '<button type="button">Отменить</button>' : ''}`;
        const remove = () => {
            el.classList.add('leaving');
            setTimeout(() => el.remove(), 250);
        };
        if (onUndo) {
            el.querySelector('button').addEventListener('click', () => {
                onUndo();
                remove();
            });
        }
        toasts.append(el);
        // Открытые листы лежат в верхнем слое: повторный показ поднимает уведомления над ними
        if (toasts.showPopover) { // Старые WebView popover не знают, там работает обычный fixed
            if (toasts.matches(':popover-open')) toasts.hidePopover();
            toasts.showPopover();
        }
        while (toasts.children.length > 3) toasts.firstChild.remove();
        setTimeout(remove, onUndo ? 6000 : 3500);
    };

    const ask = ({ title, text, buttons }) => new Promise((resolve) => {
        askTitle.textContent = title;
        askText.textContent = text;
        askButtons.innerHTML = buttons.map((b) => `<button class="btn ${b.style || ''}" value="${esc(b.value)}">${esc(b.label)}</button>`).join('');
        askDialog.returnValue = '';
        askDialog.addEventListener('close', () => resolve(askDialog.returnValue), { once: true });
        askDialog.showModal();
    });

    const download = (filename, content, type) => {
        const url = URL.createObjectURL(new Blob([content], { type }));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    // --- Карточка манхвы ---
    const openDetail = (id, kicker = '') => {
        state.detailId = id;
        state.detailKicker = kicker;
        renderDetail();
        if (!detailSheet.open) detailSheet.showModal();
        detailSheet.scrollTop = 0;
    };

    const renderDetail = () => {
        const m = findManga(state.detailId);
        if (!m) {
            detailSheet.close();
            return;
        }
        const progress = progressOf(m);
        const link = safeLink(m.link);
        const history = [...m.history].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
        const scroll = detailSheet.scrollTop;

        detailBody.innerHTML = `
            <div class="detail-hero">
                <div class="detail-glow" aria-hidden="true">${coverHTML(m)}</div>
                ${coverHTML(m, 'detail-cover')}
                <div>
                    ${state.detailKicker ? `<div class="detail-kicker">${esc(state.detailKicker)}</div>` : ''}
                    <h2 class="detail-title">${esc(m.title)}</h2>
                    ${m.altTitle ? `<div class="detail-alt">${esc(m.altTitle)}</div>` : ''}
                    <div class="detail-meta">
                        <span>${m.ongoing ? 'Онгоинг' : (m.totalChapters ? 'Выпуск завершён' : 'Выпуск неизвестен')}</span>
                        ${m.releaseDays.length ? `<span>Выходит: ${[...m.releaseDays].sort((a, b) => a - b).map((d) => WEEKDAYS[d]).join(', ')}</span>` : ''}
                        ${m.rereadDates.length ? `<span>Перечитано: ${m.rereadDates.length}</span>` : ''}
                        <span>Читал: ${relativeDate(m.lastReadDate)}</span>
                        <span>Добавлено: ${formatDate(m.addedDate, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    </div>
                    <div class="detail-actions">
                        ${link ? `<a class="btn btn-primary" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${icon('link')}Читать на ${esc(hostOf(link))}</a>` : ''}
                        ${state.detailKicker ? `<button class="btn" data-action="random">${icon('dice')}Ещё раз</button>` : ''}
                    </div>
                </div>
                <div class="detail-top">
                    <button class="round-btn ${m.favorite ? 'fav-on' : ''}" data-action="favorite" data-id="${esc(m.id)}" aria-pressed="${m.favorite}" aria-label="Избранное" title="Избранное">${icon('heart', m.favorite ? 'filled' : '')}</button>
                    <button class="round-btn" data-action="close-sheet" aria-label="Закрыть">${icon('close')}</button>
                </div>
            </div>
            <div class="sheet-body">
                <div class="stepper">
                    <button class="stepper-btn" data-action="dec" data-id="${esc(m.id)}" aria-label="На главу назад">${icon('minus')}</button>
                    <div class="stepper-center">
                        <div class="stepper-value">${m.currentChapter}${m.totalChapters ? `<small> из ${m.totalChapters}</small>` : ''}</div>
                        ${progress !== null ? barHTML(progress) : ''}
                    </div>
                    <button class="stepper-btn go" data-action="inc" data-id="${esc(m.id)}" aria-label="Прочитал главу">${icon('plus')}</button>
                </div>
                ${m.ongoing ? `
                <div class="mini-row">
                    <span>Вышло глав</span>
                    <div class="mini-actions">
                        <button class="round-btn" data-action="released" data-delta="-1" data-id="${esc(m.id)}" aria-label="Меньше">${icon('minus')}</button>
                        <span>${m.totalChapters || '—'}</span>
                        <button class="round-btn" data-action="released" data-delta="1" data-id="${esc(m.id)}" aria-label="Вышла новая глава">${icon('plus')}</button>
                    </div>
                </div>` : ''}

                ${m.rereading ? `
                <div class="mini-row">
                    <span>Идёт перечитывание, круг ${m.rereadDates.length + 2}</span>
                    <div class="mini-actions"><button class="btn" data-action="reread-finish" data-id="${esc(m.id)}">Завершить</button></div>
                </div>` : ''}

                <div class="detail-section">
                    <h3>Статус</h3>
                    <div class="chips">
                        ${Object.entries(STATUSES).map(([key, label]) => `<button class="chip small ${m.status === key ? 'active' : ''}" data-action="set-status" data-id="${esc(m.id)}" data-value="${key}">${label}</button>`).join('')}
                    </div>
                </div>

                <div class="detail-section">
                    <h3>Оценка</h3>
                    <div class="stars" role="radiogroup" aria-label="Оценка">
                        ${[1, 2, 3, 4, 5].map((n) => `<button class="star ${m.rating >= n ? 'on' : ''}" data-action="rate" data-id="${esc(m.id)}" data-value="${n}" aria-label="${n} из 5" role="radio" aria-checked="${m.rating === n}">${icon('star')}</button>`).join('')}
                    </div>
                </div>

                ${m.genres.length ? `
                <div class="detail-section">
                    <h3>Жанры</h3>
                    <div class="chips">${m.genres.map((g) => `<button class="chip small" data-action="open-genre" data-value="${esc(g)}">${esc(g)}</button>`).join('')}</div>
                </div>` : ''}

                <div class="detail-section">
                    <h3><label for="detail-notes">Заметки</label></h3>
                    <textarea id="detail-notes" data-id="${esc(m.id)}" placeholder="На чём остановился, что понравилось, где читать">${esc(m.notes)}</textarea>
                </div>

                ${history.length ? `
                <div class="detail-section">
                    <h3>История чтения</h3>
                    <div class="history">${history.map((h) => `<div><span>${formatDate(h.date)}</span><b>${chaptersWord(h.count)}</b></div>`).join('')}</div>
                </div>` : ''}

                <div class="detail-foot">
                    ${m.status === 'completed' && !m.rereading ? `<button class="btn" data-action="reread" data-id="${esc(m.id)}">${icon('repeat')}Перечитать</button>` : ''}
                    <button class="btn" data-action="edit" data-id="${esc(m.id)}">${icon('edit')}Редактировать</button>
                    <button class="btn btn-danger" data-action="delete" data-id="${esc(m.id)}">${icon('trash')}Удалить</button>
                </div>
            </div>`;
        detailSheet.scrollTop = scroll;
    };

    // --- Форма ---
    const showFormCover = () => {
        const hasCover = Boolean(state.formCover);
        coverPreview.hidden = !hasCover;
        coverRemove.hidden = !hasCover;
        coverHint.hidden = hasCover;
        if (hasCover) coverPreview.src = state.formCover;
        else coverPreview.removeAttribute('src');
    };

    const paintFormStatus = () => {
        fStatus.innerHTML = Object.entries(STATUSES).map(([key, label]) => `
            <button type="button" class="chip small" role="radio" aria-checked="${state.formStatus === key}" data-action="form-status" data-value="${key}">${label}</button>`).join('');
    };

    const paintFormDays = () => {
        fDaysField.hidden = !fOngoing.checked;
        fDays.innerHTML = WEEKDAYS.map((label, day) => `
            <button type="button" class="chip small ${state.formDays.includes(day) ? 'active' : ''}" aria-pressed="${state.formDays.includes(day)}" data-action="form-day" data-value="${day}">${label}</button>`).join('');
    };

    const clearFormErrors = () => {
        mangaForm.querySelectorAll('.field-error').forEach((el) => { el.textContent = ''; });
        mangaForm.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
    };

    const openForm = (id = null) => {
        const m = id ? findManga(id) : null;
        state.editingId = m ? m.id : null;
        state.formCover = m ? m.cover : '';
        state.formStatus = m ? m.status : 'reading';
        state.formDays = m ? [...m.releaseDays] : [];
        state.formCatalog = {};
        formTitle.textContent = m ? 'Редактировать' : 'Новая манхва';
        formSubmit.textContent = m ? 'Сохранить' : 'Добавить';
        fTitle.value = m ? m.title : '';
        fAlt.value = m ? m.altTitle : '';
        fCurrent.value = m ? m.currentChapter : 0;
        fTotal.value = m && m.totalChapters ? m.totalChapters : '';
        fOngoing.checked = m ? m.ongoing : false;
        fDate.value = m ? m.lastReadDate : todayStr();
        fLink.value = m ? m.link : '';
        fGenres.value = m ? m.genres.join(', ') : '';
        lookupResults.hidden = true;
        clearFormErrors();
        paintFormStatus();
        paintFormDays();
        showFormCover();
        formSheet.showModal();
        formSheet.scrollTop = 0;
        fTitle.focus();
    };

    const showError = (input, key, message) => {
        input.classList.add('invalid');
        mangaForm.querySelector(`[data-error="${key}"]`).textContent = message;
    };

    const validateForm = () => {
        clearFormErrors();
        const current = Number.parseInt(fCurrent.value, 10);
        const total = fTotal.value === '' ? null : Number.parseInt(fTotal.value, 10);
        let firstInvalid = null;
        const fail = (input, key, message) => {
            showError(input, key, message);
            firstInvalid = firstInvalid || input;
        };

        if (!fTitle.value.trim()) fail(fTitle, 'title', 'Введи название');
        if (Number.isNaN(current) || current < 0) fail(fCurrent, 'current', 'Нужно число от 0');
        if (total !== null && (Number.isNaN(total) || total < 0)) fail(fTotal, 'total', 'Нужно число от 0');
        else if (total && !fOngoing.checked && current > total) fail(fTotal, 'total', 'Меньше, чем уже прочитано');
        if (fLink.value.trim() && !safeLink(fLink.value.trim())) fail(fLink, 'link', 'Ссылка должна начинаться с http:// или https://');

        if (firstInvalid) firstInvalid.focus();
        return !firstInvalid;
    };

    const readForm = () => ({
        title: fTitle.value.trim(),
        altTitle: fAlt.value.trim(),
        status: state.formStatus,
        currentChapter: Number.parseInt(fCurrent.value, 10),
        totalChapters: Number.parseInt(fTotal.value, 10) || null,
        ongoing: fOngoing.checked,
        lastReadDate: fDate.value,
        link: fLink.value.trim(),
        genres: fGenres.value.split(',').map((g) => g.trim()).filter(Boolean),
        cover: state.formCover,
        releaseDays: fOngoing.checked ? state.formDays : [],
        ...state.formCatalog
    });

    const submitForm = () => {
        if (!validateForm()) return;
        const data = readForm();
        const editing = findManga(state.editingId);

        if (editing) {
            commit(() => {
                const delta = data.currentChapter - editing.currentChapter;
                const dateUntouched = data.lastReadDate === editing.lastReadDate;
                Object.assign(editing, data);
                if (delta !== 0) logChapters(editing, delta);
                if (delta > 0 && dateUntouched) editing.lastReadDate = todayStr();
                if (delta > 0 && !editing.ongoing && editing.totalChapters && editing.currentChapter >= editing.totalChapters) {
                    editing.status = 'completed';
                }
            }, { message: 'Изменения сохранены', undo: true });
        } else {
            const manga = normalizeManga({ ...data, id: uid(), addedDate: todayStr() });
            commit(() => state.mangas.push(manga), { message: `«${manga.title}» добавлена`, undo: true });
        }
        formSheet.close();
    };

    // Обложку уменьшаем: иначе несколько картинок забьют localStorage
    const compressImage = (file) => new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, COVER_MAX_WIDTH / img.width);
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Не удалось прочитать картинку'));
        };
        img.src = url;
    });

    const useCoverFile = async (file) => {
        if (!file || !file.type.startsWith('image/')) return;
        try {
            state.formCover = await compressImage(file);
            showFormCover();
        } catch (e) {
            toast(e.message);
        }
    };

    // --- Каталоги: запросы идут напрямую или через расширение, если оно подключено ---
    const directJson = async (url) => {
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
    };

    const fetchJson = (url) => (state.extension ? extensionFetch(url) : directJson(url));

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const ANILIST_QUERY = `query ($search: String) {
        Page(perPage: 6) {
            media(search: $search, type: MANGA, isAdult: false) {
                siteUrl status chapters genres countryOfOrigin
                title { romaji english native }
                coverImage { large }
            }
        }
    }`;

    const shikimoriCover = (image) => image && image.original && !image.original.includes('missing') ? `${SHIKIMORI}${image.original}` : '';

    // Shikimori хранит русские названия, поэтому он основной источник поиска
    const searchShikimori = async (search) => {
        const items = await fetchJson(`${SHIKIMORI}/api/mangas?search=${encodeURIComponent(search)}&limit=8`);
        return items
            .filter((item) => !['novel', 'light_novel'].includes(item.kind))
            .map((item) => ({
                title: item.russian || item.name,
                alt: item.russian ? item.name : '',
                chapters: item.chapters || 0,
                ongoing: ['ongoing', 'anons', 'paused'].includes(item.status),
                cover: shikimoriCover(item.image),
                link: `${SHIKIMORI}${item.url}`,
                genres: [],
                shikimoriId: String(item.id)
            }));
    };

    const searchAniList = async (search) => {
        const response = await fetch('https://graphql.anilist.co', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ query: ANILIST_QUERY, variables: { search } })
        });
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()).data.Page.media.map((item) => ({
            title: item.title.english || item.title.romaji,
            alt: item.title.native || item.title.romaji || '',
            chapters: item.chapters || 0,
            ongoing: ['RELEASING', 'HIATUS'].includes(item.status),
            cover: item.coverImage.large,
            link: item.siteUrl,
            genres: item.genres
        }));
    };

    let lookupTimer = 0;
    let lookupRun = 0;

    const lookup = async () => {
        const search = fTitle.value.trim();
        if (!search) {
            showError(fTitle, 'title', 'Введи название для поиска');
            return;
        }
        const run = ++lookupRun; // Ответ на устаревший запрос не должен перекрыть свежий
        lookupResults.hidden = false;
        lookupResults.innerHTML = '<div class="lookup-note">Ищу в каталогах...</div>';
        const searches = [searchShikimori(search)];
        if (!/[а-яё]/i.test(search)) searches.push(searchAniList(search)); // AniList не знает русских названий

        const results = await Promise.allSettled(searches);
        if (run !== lookupRun) return;
        const seen = new Set();
        const items = results
            .flatMap((result) => result.status === 'fulfilled' ? result.value : [])
            .filter((item) => {
                const key = normalizeTitle(item.alt || item.title);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .slice(0, 8);

        lookupResults.lookupItems = items;
        if (items.length) {
            lookupResults.innerHTML = items.map((item, i) => `
                <button type="button" class="lookup-item" data-action="lookup-pick" data-index="${i}">
                    <img src="${esc(item.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">
                    <span><b>${esc(item.title)}</b><small>${item.chapters ? chaptersWord(item.chapters) : 'Число глав неизвестно'}${item.ongoing ? ' · выходит' : ''}</small></span>
                </button>`).join('');
        } else if (results.every((result) => result.status === 'rejected')) {
            lookupResults.innerHTML = '<div class="lookup-note">Каталоги недоступны. Проверь интернет или заполни поля вручную.</div>';
        } else {
            lookupResults.innerHTML = '<div class="lookup-note">Ничего не нашлось. Попробуй другое написание названия.</div>';
        }
    };

    const pickLookup = async (item) => {
        lookupRun += 1;
        fTitle.value = item.title;
        fAlt.value = item.alt;
        fOngoing.checked = item.ongoing;
        if (item.chapters) fTotal.value = item.chapters;
        if (!fLink.value) fLink.value = item.link;
        fGenres.value = item.genres.join(', ');
        state.formCover = item.cover;
        state.formCatalog = item.shikimoriId ? { shikimoriId: item.shikimoriId } : {};
        showFormCover();
        paintFormDays();
        lookupResults.hidden = true;
        if (!item.shikimoriId) return;
        // Русские жанры есть только в полной карточке
        try {
            const details = await fetchJson(`${SHIKIMORI}/api/mangas/${item.shikimoriId}`);
            if (!fGenres.value) fGenres.value = details.genres.map((g) => g.russian || g.name).join(', ');
        } catch (e) { /* Жанры необязательны */ }
    };

    // Тайтл из расширения дополняем из каталога: жанры, второе название, число глав
    const enrichManga = async (id) => {
        const m = findManga(id);
        if (!m) return;
        try {
            const found = (await searchShikimori(m.title)).find((item) => normalizeTitle(item.title) === normalizeTitle(m.title) || normalizeTitle(item.alt) === normalizeTitle(m.title));
            if (!found) return;
            const details = await fetchJson(`${SHIKIMORI}/api/mangas/${found.shikimoriId}`);
            commit(() => {
                m.shikimoriId = found.shikimoriId;
                if (!m.altTitle) m.altTitle = found.alt;
                if (!m.cover) m.cover = found.cover;
                if (!m.totalChapters && found.chapters) m.totalChapters = found.chapters;
                if (!m.genres.length) m.genres = details.genres.map((g) => g.russian || g.name);
                if (found.ongoing) m.ongoing = true;
            });
        } catch (e) { /* Дополнение необязательно: тайтл уже добавлен */ }
    };

    // --- Проверка новых глав ---
    const mangadexTitles = (item) => [
        ...Object.values(item.attributes.title),
        ...item.attributes.altTitles.flatMap((alt) => Object.values(alt))
    ].map(normalizeTitle);

    const findMangadexId = async (m) => {
        if (m.mangadexId) return m.mangadexId;
        for (const title of [m.title, m.altTitle].filter(Boolean)) {
            const found = await directJson(`https://api.mangadex.org/manga?title=${encodeURIComponent(title)}&limit=5`);
            const match = found.data.find((item) => mangadexTitles(item).includes(normalizeTitle(title)));
            if (match) return match.id;
            await wait(CHECK_DELAY);
        }
        return '';
    };

    // MangaDex отвечает расширению 403, поэтому к нему только напрямую, а это возможно лишь не с file://
    const latestFromMangadex = async (m) => {
        m.mangadexId = await findMangadexId(m);
        if (!m.mangadexId) return 0;
        const feed = await directJson(`https://api.mangadex.org/manga/${m.mangadexId}/feed?limit=1&order[chapter]=desc&translatedLanguage[]=ru&translatedLanguage[]=en`);
        return Number.parseInt(feed.data[0]?.attributes.chapter, 10) || 0;
    };

    const remangaDirOf = (m) => m.remangaDir || (m.link.match(/remanga\.org\/manga\/([^/?#]+)/) || [])[1] || '';

    const findRemangaDir = async (m) => {
        const known = remangaDirOf(m);
        if (known) return known;
        const found = await fetchJson(`https://api.remanga.org/api/search/?query=${encodeURIComponent(m.title)}&count=5`);
        const wanted = [m.title, m.altTitle].filter(Boolean).map(normalizeTitle);
        const match = found.content.find((item) => [item.main_name, item.rus_name, item.en_name].map(normalizeTitle).some((name) => wanted.includes(name)));
        return match ? match.dir : '';
    };

    const latestFromRemanga = async (m) => {
        m.remangaDir = await findRemangaDir(m);
        if (!m.remangaDir) return 0;
        const found = await fetchJson(`https://api.remanga.org/api/titles/${encodeURIComponent(m.remangaDir)}/`);
        return Number(found.content.count_chapters) || 0;
    };

    const latestFromShikimori = async (m) => {
        if (!m.shikimoriId) return 0;
        const found = await fetchJson(`${SHIKIMORI}/api/mangas/${m.shikimoriId}`);
        return Number(found.chapters) || 0;
    };

    const chapterSources = () => [
        latestFromShikimori,
        ...(location.protocol === 'file:' ? [] : [latestFromMangadex]),
        ...(state.extension ? [latestFromRemanga] : [])
    ];

    const toastNewChapters = (count) => toast(`Новые главы: ${count} ${plural(count, 'тайтл', 'тайтла', 'тайтлов')}`);

    // Принимает пары [id, последняя глава] и от своей проверки, и от фоновой в расширении
    const applyLatest = (entries) => commit(() => {
        let count = 0;
        for (const [id, chapter] of entries) {
            const m = findManga(id);
            if (m && chapter > (m.totalChapters || 0)) {
                m.totalChapters = chapter;
                if (chapter > m.currentChapter) count += 1;
            }
        }
        return count;
    });

    const checkNewChapters = async ({ silent = false } = {}) => {
        if (state.checking) return;
        const targets = state.mangas.filter((m) => m.ongoing && !m.rereading && ['reading', 'on-hold', 'planned'].includes(m.status));
        if (!targets.length) {
            if (!silent) toast('Нет онгоингов для проверки');
            return;
        }
        state.checking = true;
        render();
        const sources = chapterSources();
        const latest = new Map();
        let reached = 0;

        for (const m of targets) {
            for (const source of sources) {
                try {
                    latest.set(m.id, Math.max(latest.get(m.id) || 0, await source(m)));
                    reached += 1;
                } catch (e) { /* Один недоступный источник не должен останавливать проверку */ }
                await wait(CHECK_DELAY);
            }
        }

        state.checking = false;
        state.settings.lastCheck = todayStr();
        saveSettings();
        const updated = applyLatest(latest);

        if (updated) toastNewChapters(updated);
        else if (!silent && reached === 0) toast('Каталоги недоступны с этой страницы. Подключи расширение трекера.');
        else if (!silent) toast('Новых глав нет');
    };

    // --- Связь с расширением ---
    const extensionRequests = new Map();

    const postToExtension = (message) => window.postMessage({ source: PAGE_SOURCE, ...message }, '*');

    const extensionFetch = (url) => new Promise((resolve, reject) => {
        const id = uid();
        const timer = setTimeout(() => {
            extensionRequests.delete(id);
            reject(new Error('timeout'));
        }, 20000);
        extensionRequests.set(id, { resolve, reject, timer });
        postToExtension({ type: 'fetch', id, url });
    });

    // Короткого списка расширению хватает, чтобы узнавать тайтлы и проверять главы без открытого трекера
    const sendIndexToExtension = () => {
        if (!state.extension) return;
        postToExtension({
            type: 'index',
            items: state.mangas.map((m) => ({
                id: m.id,
                title: m.title,
                altTitle: m.altTitle,
                link: m.link,
                cover: safeLink(m.cover), // Загруженные обложки слишком тяжёлые для хранилища расширения
                status: m.status,
                currentChapter: m.currentChapter,
                totalChapters: m.totalChapters,
                ongoing: m.ongoing,
                rereading: m.rereading,
                shikimoriId: m.shikimoriId,
                remangaDir: m.remangaDir || remangaDirOf(m)
            }))
        });
    };

    const samePage = (a, b) => {
        try {
            const first = new URL(a);
            const second = new URL(b);
            return first.hostname === second.hostname && first.pathname.replace(/\/$/, '') === second.pathname.replace(/\/$/, '');
        } catch (e) {
            return false;
        }
    };

    const findExisting = (item) => {
        const wanted = normalizeTitle(item.title);
        return state.mangas.find((m) => samePage(m.link, item.link) || normalizeTitle(m.title) === wanted || (m.altTitle && normalizeTitle(m.altTitle) === wanted));
    };

    const receiveFromExtension = (items) => {
        const valid = items.filter((item) => item && typeof item.title === 'string' && item.title.trim());
        const addedIds = [];
        let updated = 0;
        const summary = () => {
            valid.forEach((item) => {
                const chapter = Math.max(0, Number.parseInt(item.chapter, 10) || 0);
                const existing = findManga(item.mangaId) || findExisting(item);
                if (existing) {
                    if (chapter > existing.currentChapter) stepChapter(existing, chapter - existing.currentChapter);
                    if (STATUSES[item.setStatus]) existing.status = item.setStatus;
                    if (!existing.link) existing.link = safeLink(item.link);
                    if (!existing.mangadexId) existing.mangadexId = item.mangadexId || '';
                    if (!existing.remangaDir) existing.remangaDir = item.remangaDir || '';
                    updated += 1;
                    return;
                }
                const manga = normalizeManga({
                    id: uid(),
                    title: item.title.trim().slice(0, 200),
                    currentChapter: chapter,
                    totalChapters: Number.parseInt(item.total, 10) || null,
                    status: STATUSES[item.status] ? item.status : 'reading',
                    link: safeLink(item.link),
                    cover: safeLink(item.cover),
                    mangadexId: item.mangadexId || '',
                    remangaDir: item.remangaDir || '',
                    lastReadDate: chapter ? todayStr() : '',
                    addedDate: todayStr()
                });
                state.mangas.push(manga);
                addedIds.push(manga.id);
            });
            return `Из расширения: новых ${addedIds.length}, обновлено ${updated}`;
        };
        commit(summary, { message: (text) => text, undo: true });
        postToExtension({ type: 'ack', ids: items.map((item) => item.id) });
        addedIds.forEach(enrichManga);
    };

    const onExtensionMessage = (e) => {
        if (e.source !== window || e.data?.source !== EXTENSION_SOURCE) return;
        const { type, id, ok, data, error, items, latest } = e.data;
        if (type === 'ready') {
            const first = !state.extension;
            state.extension = true;
            if (first) {
                sendIndexToExtension();
                if (state.route === 'settings') render();
            }
        } else if (type === 'fetch-result' && extensionRequests.has(id)) {
            const request = extensionRequests.get(id);
            extensionRequests.delete(id);
            clearTimeout(request.timer);
            if (ok) request.resolve(data);
            else request.reject(new Error(error));
        } else if (type === 'incoming' && Array.isArray(items) && items.length) {
            receiveFromExtension(items);
        } else if (type === 'chapters' && latest) {
            const updated = applyLatest(Object.entries(latest));
            postToExtension({ type: 'chapters-ack', ids: Object.keys(latest) });
            if (updated) toastNewChapters(updated);
        }
    };

    // --- Случайный выбор ---
    const pickRandom = () => {
        const pool = state.mangas.filter((m) => ['planned', 'reading', 'on-hold'].includes(m.status) && m.id !== state.detailId);
        const list = pool.length ? pool : state.mangas;
        if (!list.length) {
            toast('Сначала добавь что-нибудь в коллекцию');
            return;
        }
        openDetail(list[Math.floor(Math.random() * list.length)].id, 'Случайный выбор');
    };

    // --- Экспорт и импорт ---
    const markExported = () => {
        state.settings.lastExport = todayStr();
        saveSettings();
        if (state.route === 'settings') render();
    };

    const exportJson = () => {
        if (!state.mangas.length) {
            toast('Пока нечего экспортировать');
            return;
        }
        const payload = { app: 'manhwa-tracker', version: 2, exportedAt: new Date().toISOString(), mangas: state.mangas };
        download(`manhwa_tracker_${todayStr()}.json`, JSON.stringify(payload, null, 2), 'application/json');
        markExported();
        toast('Экспорт готов');
    };

    const exportCsv = () => {
        if (!state.mangas.length) {
            toast('Пока нечего экспортировать');
            return;
        }
        const header = ['Название', 'Другое название', 'Статус', 'Прочитано', 'Всего', 'Онгоинг', 'Оценка', 'Избранное', 'Последнее чтение', 'Добавлено', 'Жанры', 'Ссылка', 'Заметки'];
        const cell = (value) => {
            // Апостроф не даёт таблицам принять текст за формулу
            const text = /^[=+\-@]/.test(String(value)) ? `'${value}` : String(value);
            return `"${text.replace(/"/g, '""')}"`;
        };
        const rows = state.mangas.map((m) => [
            m.title, m.altTitle, STATUSES[m.status], m.currentChapter, m.totalChapters ?? '', m.ongoing ? 'да' : 'нет',
            m.rating || '', m.favorite ? 'да' : 'нет', m.lastReadDate, m.addedDate, m.genres.join(', '), m.link, m.notes
        ].map(cell).join(';'));
        download(`manhwa_tracker_${todayStr()}.csv`, `﻿${[header.map(cell).join(';'), ...rows].join('\r\n')}`, 'text/csv');
        markExported();
        toast('Экспорт готов');
    };

    const mergeMangas = (incoming) => {
        let added = 0;
        let updated = 0;
        incoming.forEach((item) => {
            const existing = state.mangas.find((m) => m.id === item.id || m.title.toLowerCase() === item.title.toLowerCase());
            if (!existing) {
                state.mangas.push(item);
                added += 1;
            } else if ((item.lastReadDate || '') >= (existing.lastReadDate || '')) {
                Object.assign(existing, { ...item, id: existing.id });
                updated += 1;
            }
        });
        return `Новых: ${added}, обновлено: ${updated}`;
    };

    const importFile = async (file) => {
        let incoming;
        try {
            const parsed = JSON.parse(await file.text());
            const list = Array.isArray(parsed) ? parsed : parsed.mangas;
            if (!Array.isArray(list) || !list.every((m) => m && m.title)) throw new Error('format');
            incoming = list.map(normalizeManga);
        } catch (e) {
            toast('Файл не похож на экспорт трекера');
            return;
        }
        const choice = await ask({
            title: 'Импорт данных',
            text: `В файле ${incoming.length} ${plural(incoming.length, 'тайтл', 'тайтла', 'тайтлов')}. Объединить с коллекцией или заменить её целиком?`,
            buttons: [
                { label: 'Отмена', value: '' },
                { label: 'Заменить', value: 'replace', style: 'btn-danger' },
                { label: 'Объединить', value: 'merge', style: 'btn-primary' }
            ]
        });
        if (choice === 'merge') {
            commit(() => mergeMangas(incoming), { message: (text) => text, undo: true });
        } else if (choice === 'replace') {
            commit(() => { state.mangas = incoming; }, { message: 'Коллекция заменена', undo: true });
        }
    };

    // --- Файл данных на диске ---
    // Папку выбирает пользователь, доступ к ней браузер помнит по дескриптору в IndexedDB
    const disk = {
        supported: 'showDirectoryPicker' in window,
        dir: null,
        status: 'off', // off, permission, ok или error
        cached: true,
        savedAt: '',
        size: 0,
        seenModified: 0,
        revision: 0,
        timer: 0,
        queue: Promise.resolve()
    };

    // dirty: есть изменения, которых нет в файле; base: версия файла, от которой они сделаны
    const readSync = () => {
        try {
            return { dirty: false, base: '', ...JSON.parse(localStorage.getItem(SYNC_KEY) || '{}') };
        } catch (e) {
            return { dirty: false, base: '' };
        }
    };
    const writeSync = (sync) => localStorage.setItem(SYNC_KEY, JSON.stringify(sync));

    const handleStore = (mode, run) => new Promise((resolve, reject) => {
        const open = indexedDB.open('manhwa-tracker', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('handles');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const tx = open.result.transaction('handles', mode);
            const request = run(tx.objectStore('handles'));
            tx.oncomplete = () => {
                open.result.close();
                resolve(request.result);
            };
            tx.onerror = () => reject(tx.error);
        };
    });

    const diskStatusText = () => {
        const size = `${(disk.size / 1048576).toFixed(1).replace('.', ',')} МБ`;
        const time = disk.savedAt ? new Date(disk.savedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
        if (disk.status === 'permission') return `Папка «${disk.dir.name}»: нужно разрешение браузера.`;
        if (disk.status === 'error') return `Папка «${disk.dir.name}»: файл недоступен, изменения пока в браузере.`;
        return `Папка «${disk.dir.name}», файл ${size}${time ? `, сохранено ${time}` : ''}.`;
    };

    const paintDisk = () => {
        const needsAction = disk.status === 'permission' || disk.status === 'error';
        diskBanner.hidden = !needsAction;
        if (needsAction) {
            diskBanner.innerHTML = `
                <span>${disk.status === 'permission' ? `Разреши доступ к папке «${esc(disk.dir.name)}», чтобы открыть данные с диска.` : 'Файл с данными недоступен или повреждён. Изменения пока сохраняются в браузере.'}</span>
                <button class="btn btn-primary" data-action="${disk.status === 'permission' ? 'disk-grant' : 'disk-connect'}">${icon('folder')}${disk.status === 'permission' ? 'Разрешить' : 'Выбрать папку'}</button>`;
        }
        const status = document.getElementById('disk-status');
        if (status && disk.dir) status.textContent = diskStatusText();
    };

    const diskFile = async () => {
        try {
            return await (await disk.dir.getFileHandle(DATA_FILE)).getFile();
        } catch (e) {
            if (e.name === 'NotFoundError') return null;
            throw e;
        }
    };

    const parseDisk = (text) => {
        const data = JSON.parse(text);
        const mangas = Array.isArray(data) ? data : data.mangas;
        if (!Array.isArray(mangas)) throw new SyntaxError('format');
        return Array.isArray(data) ? { mangas, savedAt: '' } : data;
    };

    const writeTextFile = async (folder, name, text) => {
        const handle = await folder.getFileHandle(name, { create: true });
        const writable = await handle.createWritable(); // Запись идёт во временный файл и подменяет основной при закрытии
        await writable.write(text);
        await writable.close();
        return handle;
    };

    const backupFolder = () => disk.dir.getDirectoryHandle(BACKUP_DIR, { create: true });

    // Первая запись за день откладывает прошлую версию в копии, старые копии уходят
    const backupDaily = async () => {
        const file = await diskFile();
        if (!file) return;
        const folder = await backupFolder();
        const name = `manhwa-${todayStr()}.json`;
        try {
            await folder.getFileHandle(name);
            return;
        } catch (e) {
            if (e.name !== 'NotFoundError') throw e;
        }
        await writeTextFile(folder, name, await file.text());
        const names = [];
        for await (const entry of folder.keys()) {
            if (/^manhwa-\d{4}-\d{2}-\d{2}\.json$/.test(entry)) names.push(entry);
        }
        await Promise.all(names.sort().slice(0, -BACKUP_KEEP).map((entry) => folder.removeEntry(entry)));
    };

    const diskPayload = (savedAt) => ({ app: 'manhwa-tracker', version: 3, savedAt, theme: state.theme, settings: state.settings, mangas: state.mangas });

    // Проигравшая в конфликте версия не пропадает: она ложится рядом с копиями
    const backupConflict = async (text) => writeTextFile(await backupFolder(), `conflict-${Date.now()}.json`, text);

    const writeDisk = async () => {
        const { revision } = disk;
        const savedAt = new Date().toISOString();
        await backupDaily();
        const handle = await writeTextFile(disk.dir, DATA_FILE, JSON.stringify(diskPayload(savedAt)));
        const file = await handle.getFile();
        disk.seenModified = file.lastModified;
        disk.size = file.size;
        disk.savedAt = savedAt;
        // Пока шла запись, могли появиться новые правки: для них уже стоит свой таймер
        writeSync({ dirty: disk.revision !== revision, base: disk.cached ? savedAt : '' });
        disk.status = 'ok';
        paintDisk();
    };

    const applyDisk = (remote) => {
        state.mangas = remote.mangas.map(normalizeManga);
        absorbTitles({ share: true });
        if (remote.settings) {
            state.settings = { ...state.settings, ...remote.settings };
            root.dataset.accent = state.settings.accent;
            root.dataset.glass = state.settings.glass;
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
        }
        if (remote.theme) {
            state.theme = remote.theme;
            localStorage.setItem('theme', remote.theme);
            applyTheme();
        }
        disk.cached = writeCache();
        disk.savedAt = remote.savedAt || '';
        writeSync({ dirty: false, base: disk.cached ? disk.savedAt : '' });
        if (detailSheet.open && !findManga(state.detailId)) detailSheet.close();
        sendIndexToExtension();
        render();
    };

    const askConflict = (remote) => ask({
        title: 'Данные разошлись',
        text: `В файле ${remote.mangas.length} ${plural(remote.mangas.length, 'тайтл', 'тайтла', 'тайтлов')} (сохранено ${remote.savedAt ? new Date(remote.savedAt).toLocaleString('ru-RU') : 'неизвестно когда'}), в браузере ${state.mangas.length}. Какую версию оставить? Вторая сохранится в папке ${BACKUP_DIR}.`,
        buttons: [
            { label: 'Из браузера', value: 'local' },
            { label: 'Из файла', value: 'file', style: 'btn-primary' }
        ]
    });

    // Сверяется с файлом и записывает изменения; файл могли поменять другая вкладка или OneDrive
    const syncDisk = async () => {
        const file = await diskFile();
        if (file) disk.size = file.size;
        if (file && file.lastModified !== disk.seenModified) {
            const text = await file.text();
            const remote = parseDisk(text);
            disk.seenModified = file.lastModified;
            const sync = readSync();
            if (remote.savedAt !== sync.base) {
                if (!sync.dirty) {
                    applyDisk(remote);
                    disk.status = 'ok';
                    paintDisk();
                    return;
                }
                if (await askConflict(remote) === 'file') {
                    await backupConflict(JSON.stringify(diskPayload(new Date().toISOString())));
                    applyDisk(remote);
                    disk.status = 'ok';
                    paintDisk();
                    return;
                }
                await backupConflict(text);
            } else {
                disk.savedAt = remote.savedAt;
            }
        }
        if (readSync().dirty || !file) await writeDisk();
        disk.status = 'ok';
        paintDisk();
    };

    const onDiskError = (e) => {
        disk.status = e.name === 'NotAllowedError' ? 'permission' : 'error';
        paintDisk();
    };

    const diskTask = (task) => {
        disk.queue = disk.queue.then(task).catch(onDiskError);
        return disk.queue;
    };

    const flushDisk = () => {
        clearTimeout(disk.timer);
        disk.timer = 0;
        if (disk.status === 'ok' || disk.status === 'error') diskTask(syncDisk);
    };

    const markDirty = () => {
        if (!disk.dir) return;
        disk.revision += 1;
        writeSync({ ...readSync(), dirty: true });
        clearTimeout(disk.timer);
        disk.timer = setTimeout(flushDisk, SAVE_DELAY);
    };

    // Флаг dirty переживает закрытие вкладки, поэтому незаписанное догонит файл при следующем открытии
    const connectFolder = async (dir) => {
        const previous = disk.dir;
        disk.dir = dir;
        disk.seenModified = 0;
        try {
            const file = await diskFile();
            const text = file ? await file.text() : '';
            const remote = text ? parseDisk(text) : null;
            let useFile = Boolean(remote && !state.mangas.length);
            if (remote?.mangas.length && state.mangas.length) {
                const choice = await ask({
                    title: 'В папке уже есть данные',
                    text: `В файле ${remote.mangas.length} ${plural(remote.mangas.length, 'тайтл', 'тайтла', 'тайтлов')}, в браузере ${state.mangas.length}. Какую версию оставить? Вторая сохранится в папке ${BACKUP_DIR}.`,
                    buttons: [
                        { label: 'Отмена', value: '' },
                        { label: 'Из браузера', value: 'local' },
                        { label: 'Из файла', value: 'file', style: 'btn-primary' }
                    ]
                });
                if (!choice) {
                    disk.dir = previous;
                    return;
                }
                useFile = choice === 'file';
                await backupConflict(useFile ? JSON.stringify(diskPayload(new Date().toISOString())) : text);
            }
            if (useFile) {
                disk.seenModified = file.lastModified;
                disk.size = file.size;
                applyDisk(remote);
            } else {
                await writeDisk();
            }
            disk.status = 'ok';
            render();
            paintDisk();
            // Папка уже работает, даже если браузер не сохранит её на следующий запуск
            const remembered = await handleStore('readwrite', (store) => store.put(dir, 'data-folder')).then(() => true, () => false);
            toast(remembered ? `Данные теперь в папке «${dir.name}»` : 'Папка подключена до закрытия вкладки: браузер не смог её запомнить');
        } catch (e) {
            disk.dir = previous;
            toast('Не получилось открыть файл в этой папке');
        }
    };

    const pickFolder = async () => {
        let dir;
        try {
            dir = await window.showDirectoryPicker({ id: 'manhwa-tracker', mode: 'readwrite', startIn: 'documents' });
        } catch (e) {
            if (e.name !== 'AbortError') toast('Браузер не дал доступ к этой папке, выбери другую');
            return;
        }
        diskTask(() => connectFolder(dir));
    };

    const grantFolder = async () => {
        if (await disk.dir.requestPermission({ mode: 'readwrite' }) !== 'granted') return;
        disk.status = 'ok';
        await diskTask(syncDisk);
        render();
    };

    const disconnectFolder = async () => {
        const choice = await ask({
            title: 'Отключить папку?',
            text: disk.cached ? 'Файл останется на диске, а трекер снова будет хранить данные только в браузере.' : 'Коллекция не помещается в браузер, поэтому часть данных останется только в файле. Лучше сменить папку.',
            buttons: [{ label: 'Отмена', value: '' }, { label: 'Отключить', value: 'yes', style: 'btn-danger' }]
        });
        if (choice !== 'yes') return;
        clearTimeout(disk.timer);
        await handleStore('readwrite', (store) => store.delete('data-folder'));
        disk.dir = null;
        disk.status = 'off';
        localStorage.removeItem(SYNC_KEY);
        paintDisk();
        render();
    };

    const restoreFolder = async () => {
        if (!disk.supported) return;
        const dir = await handleStore('readonly', (store) => store.get('data-folder')).catch(() => null);
        if (!dir) return;
        disk.dir = dir;
        const access = await dir.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt');
        if (access === 'granted') {
            disk.status = 'ok';
            await diskTask(syncDisk);
        } else {
            disk.status = 'permission';
        }
        paintDisk();
        if (state.route === 'settings') render();
    };

    // --- Синхронизация устройств через сервер бота ---
    // У каждого тайтла есть время правки, при обмене побеждает более новая, удаления запоминаются.
    // Адрес и ключ лежат только в этом браузере: файл с данными синхронизируется через облако
    const telegram = {
        url: '',
        key: '',
        rev: 0, // До какой правки на сервере это устройство уже дочитало
        status: 'off', // off, ok, auth или error
        syncedAt: 0,
        busy: false,
        again: false,
        timer: 0,
        ...(() => {
            try {
                return JSON.parse(localStorage.getItem(BOT_KEY) || '{}');
            } catch (e) {
                return {};
            }
        })()
    };

    const saveBot = () => localStorage.setItem(BOT_KEY, JSON.stringify({ url: telegram.url, key: telegram.key, rev: telegram.rev }));

    // Что ещё не ушло на сервер: id изменённых тайтлов и удалённые с их временем
    const readQueue = () => {
        try {
            return { ids: [], deleted: {}, ...JSON.parse(localStorage.getItem(BOT_QUEUE) || '{}') };
        } catch (e) {
            return { ids: [], deleted: {} };
        }
    };
    const writeQueue = (queue) => localStorage.setItem(BOT_QUEUE, JSON.stringify(queue));

    // Обложка из файла может весить мегабайты, для сравнения хватает её начала и длины
    const fingerprint = ({ updatedAt, rev, cover = '', ...rest }) => `${JSON.stringify(rest)}|${cover.length}|${cover.slice(0, 120)}`;
    const seenTitles = new Map(state.mangas.map((m) => [m.id, fingerprint(m)]));

    // Здесь ловятся все правки, в том числе отмена из уведомления
    const stampTitles = () => {
        const now = Date.now();
        const queue = readQueue();
        const ids = new Set(state.mangas.map((m) => m.id));
        state.mangas.forEach((m) => {
            const print = fingerprint(m);
            if (seenTitles.get(m.id) === print) return;
            m.updatedAt = Math.max(now, m.updatedAt + 1);
            seenTitles.set(m.id, print);
            if (!queue.ids.includes(m.id)) queue.ids.push(m.id);
            delete queue.deleted[m.id];
        });
        [...seenTitles.keys()].filter((id) => !ids.has(id)).forEach((id) => {
            seenTitles.delete(id);
            queue.deleted[id] = now;
            queue.ids = queue.ids.filter((other) => other !== id);
        });
        if (telegram.url) writeQueue(queue);
    };

    // Данные пришли извне и время правки у них уже своё
    const absorbTitles = ({ share = false } = {}) => {
        const queue = readQueue();
        state.mangas.forEach((m) => {
            const print = fingerprint(m);
            if (share && seenTitles.get(m.id) !== print && !queue.ids.includes(m.id)) queue.ids.push(m.id);
        });
        seenTitles.clear();
        state.mangas.forEach((m) => seenTitles.set(m.id, fingerprint(m)));
        if (share && telegram.url) writeQueue(queue);
    };

    const botStatusText = () => {
        if (!telegram.url) return 'Коллекция появится на всех устройствах, а бот сможет отмечать главы и сообщать о новых. Запусти бота на сервере и подключи его.';
        if (telegram.status === 'auth') return inTelegram ? 'Сервер не принял вход. Закрой окно и открой его заново кнопкой бота.' : 'Сервер не принял ключ. Отключи бота и впиши ключ заново.';
        if (telegram.status === 'error') return `Сервер ${hostOf(telegram.url)} не отвечает, изменения отправлю позже.`;
        const time = telegram.syncedAt ? `, синхронизировано ${new Date(telegram.syncedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : '';
        return `Подключён к ${hostOf(telegram.url)}${time}.`;
    };

    const paintBot = () => {
        const status = document.getElementById('bot-status');
        if (status) status.textContent = botStatusText();
    };

    const botRequest = async (path, body) => {
        const response = await fetch(`${telegram.url}${path}`, {
            method: 'POST',
            // В окне Telegram вход подтверждает его подпись, ключ там не нужен
            headers: { Authorization: telegram.key ? `Bearer ${telegram.key}` : `tma ${webApp?.initData}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout?.(BOT_TIMEOUT)
        });
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
    };

    // Обложки из файлов остаются на своём устройстве: для сервера они слишком тяжёлые
    const botTitle = (m) => ({ ...m, cover: safeLink(m.cover) });

    const applyRemote = ({ mangas, deleted }) => {
        let changed = 0;
        mangas.forEach(({ rev, ...remote }) => {
            const local = findManga(remote.id);
            if (local && remote.updatedAt <= local.updatedAt) return;
            const merged = normalizeManga({ ...remote, cover: remote.cover || local?.cover || '' });
            if (local) state.mangas[state.mangas.indexOf(local)] = merged;
            else state.mangas.push(merged);
            changed += 1;
        });
        Object.entries(deleted).forEach(([id, at]) => {
            const local = findManga(id);
            if (local && local.updatedAt <= at) {
                state.mangas = state.mangas.filter((m) => m !== local);
                changed += 1;
            }
        });
        if (!changed) return;
        absorbTitles();
        disk.cached = writeCache();
        sendIndexToExtension();
        markDirty();
        if (detailSheet.open && !findManga(state.detailId)) detailSheet.close();
        if (!document.activeElement?.matches('input, textarea')) render();
        toast(`Синхронизация: обновлено ${changed} ${plural(changed, 'тайтл', 'тайтла', 'тайтлов')}`);
    };

    const botSync = async () => {
        if (!telegram.url) return;
        if (telegram.busy) {
            telegram.again = true;
            return;
        }
        telegram.busy = true;
        clearTimeout(telegram.timer);
        try {
            const queue = readQueue();
            const sent = queue.ids.map(findManga).filter(Boolean);
            const stamps = new Map(sent.map((m) => [m.id, m.updatedAt]));
            const answer = await botRequest('/api/sync', {
                since: telegram.rev,
                mangas: sent.map(botTitle),
                deleted: queue.deleted,
                settings: { goal: state.settings.goal, name: state.settings.name, utcOffset: -new Date().getTimezoneOffset() }
            });
            const left = readQueue();
            // Что поменялось, пока шёл запрос, уйдёт следующим разом
            left.ids = left.ids.filter((id) => !stamps.has(id) || findManga(id)?.updatedAt !== stamps.get(id));
            Object.keys(queue.deleted).forEach((id) => delete left.deleted[id]);
            if (answer.rev < telegram.rev) {
                // Сервер развернули заново с пустым хранилищем: отдаём ему всю коллекцию
                left.ids = state.mangas.map((m) => m.id);
                telegram.rev = 0;
                telegram.again = true;
            } else {
                applyRemote(answer);
                telegram.rev = answer.rev;
            }
            writeQueue(left);
            saveBot();
            telegram.status = 'ok';
            telegram.syncedAt = Date.now();
        } catch (e) {
            telegram.status = e.message === '401' ? 'auth' : 'error';
        }
        telegram.busy = false;
        paintBot();
        if (telegram.again) {
            telegram.again = false;
            botSync();
        }
    };

    const markBotDirty = () => {
        if (!telegram.url) return;
        clearTimeout(telegram.timer);
        telegram.timer = setTimeout(botSync, BOT_DELAY);
    };

    // В поле адреса можно вставить код, скопированный на другом устройстве
    const parseBotCode = (text) => {
        try {
            const { url, key } = JSON.parse(atob(text));
            return { url, key };
        } catch (e) {
            return { url: text, key: '' };
        }
    };

    const connectBot = async () => {
        const field = document.getElementById('bot-url').value.trim();
        const parsed = parseBotCode(field);
        const url = parsed.url.replace(/\/+$/, '');
        const key = parsed.key || document.getElementById('bot-key').value.trim();
        if (!/^(https:\/\/|http:\/\/localhost\b)/.test(url) || !hostOf(url) || !key) {
            toast('Нужны адрес вида https://... и ключ или код подключения');
            return;
        }
        Object.assign(telegram, { url, key, rev: 0, status: 'off' });
        writeQueue({ ids: state.mangas.map((m) => m.id), deleted: {} });
        await botSync();
        if (telegram.status === 'ok') {
            toast('Сервер подключён');
        } else {
            toast(telegram.status === 'auth' ? 'Сервер не принял ключ' : 'Сервер не ответил, проверь адрес');
            Object.assign(telegram, { url: '', key: '', status: 'off' });
            localStorage.removeItem(BOT_KEY);
            localStorage.removeItem(BOT_QUEUE);
        }
        if (state.route === 'settings') render();
    };

    // Адрес сервера приходит в ссылке кнопки бота, поэтому в Telegram вводить ничего не нужно
    const startTelegram = () => {
        if (!inTelegram) return;
        webApp.ready();
        webApp.expand();
        if (webApp.isVersionAtLeast('7.7')) webApp.disableVerticalSwipes(); // Иначе прокрутка вниз сворачивает окно
        const server = new URLSearchParams(location.search).get('server') || '';
        if (!/^(https:\/\/|http:\/\/localhost\b)/.test(server) || telegram.url === server) return;
        Object.assign(telegram, { url: server, key: '', rev: 0, status: 'off' });
        writeQueue({ ids: state.mangas.map((m) => m.id), deleted: {} });
    };

    const disconnectBot = () => {
        clearTimeout(telegram.timer);
        Object.assign(telegram, { url: '', key: '', rev: 0, status: 'off', syncedAt: 0 });
        localStorage.removeItem(BOT_KEY);
        localStorage.removeItem(BOT_QUEUE);
        render();
    };

    const copyBotCode = async () => {
        try {
            await navigator.clipboard.writeText(btoa(JSON.stringify({ url: telegram.url, key: telegram.key })));
            toast('Код скопирован. На другом устройстве вставь его в поле адреса');
        } catch (e) {
            toast('Браузер не дал скопировать код');
        }
    };

    // --- Палитра команд ---
    const paletteCommands = () => [
        { label: 'Добавить манхву', hint: 'N', name: 'plus', run: () => openForm() },
        { label: 'Случайный тайтл', hint: 'R', name: 'dice', run: pickRandom },
        { label: 'Сменить тему', hint: 'T', name: 'moon', run: () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark') },
        { label: 'Главная', hint: '1', name: 'home', run: () => { location.hash = 'home'; } },
        { label: 'Библиотека', hint: '2', name: 'library', run: () => { location.hash = 'library'; } },
        { label: 'Статистика', hint: '3', name: 'chart', run: () => { location.hash = 'stats'; } },
        { label: 'Игры', hint: '4', name: 'gamepad', run: () => { location.hash = 'games'; } },
        { label: 'Настройки', hint: '5', name: 'gear', run: () => { location.hash = 'settings'; } },
        { label: 'Экспорт JSON', hint: '', name: 'download', run: exportJson },
        { label: 'Импорт из файла', hint: '', name: 'upload', run: () => importInput.click() }
    ];

    const paintPalette = () => {
        const query = paletteQuery.value.trim().toLowerCase();
        const titles = state.mangas
            .filter((m) => query ? `${m.title} ${m.altTitle}`.toLowerCase().includes(query) : m.status === 'reading')
            .sort(SORTS.recent.compare)
            .slice(0, 6)
            .map((m) => ({ manga: m, label: m.title, hint: `Гл. ${chapterText(m)}`, run: () => openDetail(m.id) }));
        const commands = paletteCommands().filter((c) => c.label.toLowerCase().includes(query));
        state.paletteItems = [...titles, ...commands];
        state.paletteIndex = clamp(state.paletteIndex, 0, Math.max(0, state.paletteItems.length - 1));

        const itemHTML = (item, i) => `
            <button class="palette-item ${i === state.paletteIndex ? 'active' : ''}" data-action="palette-run" data-index="${i}" role="option" aria-selected="${i === state.paletteIndex}">
                ${item.manga ? coverHTML(item.manga) : icon(item.name)}
                <span>${esc(item.label)}</span>
                <small>${esc(item.hint)}</small>
            </button>`;

        if (!state.paletteItems.length) {
            paletteResults.innerHTML = '<div class="palette-empty">Ничего не нашлось</div>';
            return;
        }
        paletteResults.innerHTML = `
            ${titles.length ? `<div class="palette-group">Тайтлы</div>${titles.map(itemHTML).join('')}` : ''}
            ${commands.length ? `<div class="palette-group">Команды</div>${commands.map((c, i) => itemHTML(c, titles.length + i)).join('')}` : ''}`;
        paletteResults.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' });
    };

    const openPalette = () => {
        paletteQuery.value = '';
        state.paletteIndex = 0;
        paintPalette();
        palette.showModal();
        paletteQuery.focus();
    };

    const runPaletteItem = (index) => {
        const item = state.paletteItems[index];
        if (!item) return;
        palette.close();
        item.run();
    };

    // --- Действия по data-action ---
    const closeOpenSheet = (el) => el.closest('dialog')?.close();

    const actions = {
        open: (el) => {
            if (!state.selecting) {
                openDetail(el.dataset.id);
                return;
            }
            if (state.selected.has(el.dataset.id)) state.selected.delete(el.dataset.id);
            else state.selected.add(el.dataset.id);
            paintLibrary();
        },
        inc: (el) => readChapters(el.dataset.id, 1),
        dec: (el) => readChapters(el.dataset.id, -1),
        add: () => openForm(),
        edit: (el) => openForm(el.dataset.id),
        palette: openPalette,
        random: pickRandom,
        'toggle-theme': () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'),
        'close-sheet': closeOpenSheet,

        delete: async (el) => {
            const m = findManga(el.dataset.id);
            if (!m) return;
            const choice = await ask({
                title: 'Удалить тайтл?',
                text: `«${m.title}» исчезнет из коллекции вместе с заметками и историей.`,
                buttons: [{ label: 'Отмена', value: '' }, { label: 'Удалить', value: 'yes', style: 'btn-danger' }]
            });
            if (choice !== 'yes') return;
            detailSheet.close();
            commit(() => { state.mangas = state.mangas.filter((x) => x.id !== m.id); }, { message: `«${m.title}» удалена`, undo: true });
        },
        favorite: (el) => {
            const m = findManga(el.dataset.id);
            commit(() => { m.favorite = !m.favorite; });
        },
        rate: (el) => {
            const m = findManga(el.dataset.id);
            const value = Number(el.dataset.value);
            commit(() => { m.rating = m.rating === value ? 0 : value; });
        },
        'set-status': (el) => {
            const m = findManga(el.dataset.id);
            commit(() => {
                m.status = el.dataset.value;
                m.rereading = m.rereading && m.status === 'reading';
            });
        },
        reread: (el) => {
            const m = findManga(el.dataset.id);
            commit(() => startReread(m), { message: `«${m.title}»: начато перечитывание`, undo: true });
        },
        'reread-finish': (el) => {
            const m = findManga(el.dataset.id);
            commit(() => {
                finishReread(m);
                if (m.totalChapters) {
                    // В общем счётчике остаются только реально прочитанные главы круга
                    m.rereadChapters += m.currentChapter - m.totalChapters;
                    m.currentChapter = m.totalChapters;
                }
                m.status = 'completed';
            }, { message: 'Перечитывание завершено', undo: true });
        },
        'check-new': () => checkNewChapters(),
        'set-year': (el) => {
            state.reviewYear = Number(el.dataset.value);
            render();
        },
        released: (el) => {
            const m = findManga(el.dataset.id);
            const next = Math.max(m.currentChapter, (m.totalChapters || m.currentChapter) + Number(el.dataset.delta));
            commit(() => { m.totalChapters = next || null; });
        },
        'open-genre': (el) => {
            state.filter = { status: 'all', search: '', genre: el.dataset.value, favorites: false, unread: false };
            detailSheet.close();
            if (state.route === 'library') render();
            else location.hash = 'library';
        },

        'filter-status': (el) => { state.filter.status = el.dataset.value; paintLibrary(); },
        'filter-favorites': () => { state.filter.favorites = !state.filter.favorites; paintLibrary(); },
        'filter-unread': () => { state.filter.unread = !state.filter.unread; paintLibrary(); },
        'filter-genre': (el) => { state.filter.genre = state.filter.genre === el.dataset.value ? '' : el.dataset.value; paintLibrary(); },
        'reset-filters': () => {
            state.filter = { status: 'all', search: '', genre: '', favorites: false, unread: false };
            render();
        },
        'toggle-reverse': () => {
            state.settings.reverse = !state.settings.reverse;
            saveSettings();
            render();
        },
        'toggle-layout': () => {
            state.settings.view = state.settings.view === 'grid' ? 'list' : 'grid';
            saveSettings();
            render();
        },
        'toggle-select': () => {
            if (state.selecting) stopSelecting();
            else state.selecting = true;
            render();
        },
        'select-all': () => {
            filteredMangas().forEach((m) => state.selected.add(m.id));
            paintLibrary();
        },
        'bulk-delete': async () => {
            const ids = new Set(state.selected);
            const choice = await ask({
                title: `Удалить ${ids.size} ${plural(ids.size, 'тайтл', 'тайтла', 'тайтлов')}?`,
                text: 'Вместе с ними удалятся заметки и история чтения.',
                buttons: [{ label: 'Отмена', value: '' }, { label: 'Удалить', value: 'yes', style: 'btn-danger' }]
            });
            if (choice !== 'yes') return;
            stopSelecting();
            commit(() => { state.mangas = state.mangas.filter((m) => !ids.has(m.id)); }, { message: 'Выбранное удалено', undo: true });
        },

        'set-theme': (el) => setTheme(el.dataset.value),
        'set-accent': (el) => {
            state.settings.accent = el.dataset.value;
            root.dataset.accent = el.dataset.value;
            saveSettings();
            render();
        },
        'set-glass': (el) => {
            state.settings.glass = el.dataset.value;
            root.dataset.glass = el.dataset.value;
            saveSettings();
            render();
        },
        'export-json': exportJson,
        'export-csv': exportCsv,
        import: () => importInput.click(),
        'disk-connect': pickFolder,
        'disk-grant': grantFolder,
        'disk-disconnect': disconnectFolder,
        'bot-connect': connectBot,
        'bot-disconnect': disconnectBot,
        'bot-sync': botSync,
        'bot-code': copyBotCode,
        wipe: async () => {
            const choice = await ask({
                title: 'Очистить всю коллекцию?',
                text: 'Сразу после очистки её ещё можно вернуть кнопкой «Отменить» в уведомлении.',
                buttons: [{ label: 'Отмена', value: '' }, { label: 'Очистить', value: 'yes', style: 'btn-danger' }]
            });
            if (choice === 'yes') commit(() => { state.mangas = []; }, { message: 'Коллекция очищена', undo: true });
        },
        'quick-add': () => {
            const input = document.getElementById('quick-list');
            const existing = new Set(state.mangas.map((m) => m.title.toLowerCase()));
            const titles = [...new Set(input.value.split('\n').map((t) => t.trim()).filter(Boolean))].filter((t) => !existing.has(t.toLowerCase()));
            if (!titles.length) {
                toast('Новых названий в списке нет');
                return;
            }
            const count = titles.length;
            commit(() => {
                titles.forEach((title) => state.mangas.push(normalizeManga({ id: uid(), title, status: 'planned' })));
            }, { message: `Добавлено: ${count}`, undo: true });
        },

        lookup,
        'lookup-pick': (el) => pickLookup(lookupResults.lookupItems[Number(el.dataset.index)]),
        'form-status': (el) => { state.formStatus = el.dataset.value; paintFormStatus(); },
        'form-day': (el) => {
            const day = Number(el.dataset.value);
            state.formDays = state.formDays.includes(day) ? state.formDays.filter((d) => d !== day) : [...state.formDays, day];
            paintFormDays();
        },
        'palette-run': (el) => runPaletteItem(Number(el.dataset.index))
    };

    // --- События ---
    document.addEventListener('click', (e) => {
        const el = e.target.closest('[data-action]');
        if (el && actions[el.dataset.action]) {
            actions[el.dataset.action](el, e);
            return;
        }
        // Клик по фону закрывает лист
        if (e.target instanceof HTMLDialogElement && e.target !== askDialog) e.target.close();
    });

    // Картинка не загрузилась: остаётся цветная заглушка под ней
    document.addEventListener('error', (e) => {
        if (e.target.tagName === 'IMG' && e.target.closest('.cover')) e.target.remove();
    }, true);

    document.addEventListener('input', (e) => {
        if (e.target.id === 'lib-search') {
            state.filter.search = e.target.value;
            paintLibrary();
        }
    });

    document.addEventListener('change', (e) => {
        const { id, value } = e.target;
        if (id === 'lib-sort') {
            state.settings.sort = value;
            saveSettings();
            paintLibrary();
        } else if (id === 'set-name') {
            state.settings.name = value.trim();
            saveSettings();
        } else if (id === 'set-goal') {
            state.settings.goal = Math.max(1, Number.parseInt(value, 10) || 1);
            saveSettings();
        } else if (id === 'set-autocheck') {
            state.settings.autoCheck = e.target.checked;
            saveSettings();
        } else if (id === 'bulk-status' && value) {
            const ids = new Set(state.selected);
            stopSelecting();
            commit(() => state.mangas.forEach((m) => { if (ids.has(m.id)) m.status = value; }), { message: `Статус изменён: ${ids.size}`, undo: true });
        } else if (id === 'detail-notes') {
            // Без перерисовки: иначе клик, снявший фокус, попал бы в уже заменённую кнопку
            const m = findManga(e.target.dataset.id);
            if (m) {
                m.notes = value;
                persist();
            }
        }
    });

    mangaForm.addEventListener('submit', (e) => {
        e.preventDefault();
        submitForm();
    });

    fOngoing.addEventListener('change', paintFormDays);

    // При добавлении каталог ищется прямо по мере ввода
    fTitle.addEventListener('input', () => {
        clearTimeout(lookupTimer);
        if (state.editingId) return;
        if (fTitle.value.trim().length < 3) {
            lookupRun += 1;
            lookupResults.hidden = true;
            return;
        }
        lookupTimer = setTimeout(lookup, 500);
    });

    coverDrop.addEventListener('click', (e) => {
        if (!e.target.closest('#cover-remove')) fCoverFile.click();
    });
    coverDrop.addEventListener('keydown', (e) => {
        if (e.target === coverDrop && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            fCoverFile.click();
        }
    });
    coverDrop.addEventListener('dragover', (e) => {
        e.preventDefault();
        coverDrop.classList.add('drag');
    });
    coverDrop.addEventListener('dragleave', () => coverDrop.classList.remove('drag'));
    coverDrop.addEventListener('drop', (e) => {
        e.preventDefault();
        coverDrop.classList.remove('drag');
        useCoverFile(e.dataTransfer.files[0]);
    });
    coverRemove.addEventListener('click', () => {
        state.formCover = '';
        fCoverFile.value = '';
        showFormCover();
    });
    fCoverFile.addEventListener('change', () => useCoverFile(fCoverFile.files[0]));
    formSheet.addEventListener('paste', (e) => {
        const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
        if (file) {
            e.preventDefault();
            useCoverFile(file);
        }
    });

    importInput.addEventListener('change', () => {
        const file = importInput.files[0];
        importInput.value = ''; // Чтобы тот же файл можно было выбрать снова
        if (file) importFile(file);
    });

    paletteQuery.addEventListener('input', () => {
        state.paletteIndex = 0;
        paintPalette();
    });
    paletteQuery.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const count = state.paletteItems.length;
            if (!count) return;
            state.paletteIndex = (state.paletteIndex + (e.key === 'ArrowDown' ? 1 : -1) + count) % count;
            paintPalette();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            runPaletteItem(state.paletteIndex);
        }
    });

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            if (!palette.open && !document.querySelector('dialog[open]')) openPalette();
            return;
        }
        const typing = e.target.closest('input, textarea, select');
        if (typing || document.querySelector('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey) return;

        const shortcuts = {
            n: () => openForm(),
            r: pickRandom,
            t: () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'),
            1: () => { location.hash = 'home'; },
            2: () => { location.hash = 'library'; },
            3: () => { location.hash = 'stats'; },
            4: () => { location.hash = 'games'; },
            5: () => { location.hash = 'settings'; },
            '/': () => {
                if (state.route !== 'library') location.hash = 'library';
                setTimeout(() => document.getElementById('lib-search')?.focus(), 0);
            }
        };
        const run = shortcuts[e.key.toLowerCase()];
        if (run) {
            e.preventDefault();
            run();
        }
    });

    // Блик стекла за курсором
    let glowFrame = 0;
    document.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse' || glowFrame) return;
        glowFrame = requestAnimationFrame(() => {
            glowFrame = 0;
            const glass = e.target.closest?.('.glass');
            if (!glass) return;
            const rect = glass.getBoundingClientRect();
            glass.style.setProperty('--mx', `${e.clientX - rect.left}px`);
            glass.style.setProperty('--my', `${e.clientY - rect.top}px`);
        });
    });

    // Подсказки на диаграммах
    document.addEventListener('pointerover', (e) => {
        const target = e.target.closest?.('[data-tip]');
        tip.hidden = !target;
        if (!target) return;
        const rect = target.getBoundingClientRect();
        tip.textContent = target.dataset.tip;
        tip.style.left = `${clamp(rect.left + rect.width / 2, 110, innerWidth - 110)}px`;
        tip.style.top = `${rect.top}px`;
    });

    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (state.theme === 'auto') applyTheme();
    });
    window.addEventListener('resize', moveTabPill);
    window.addEventListener('hashchange', applyRoute);

    // Несколько вкладок: подхватываем изменения из соседней
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY) {
            state.mangas = loadMangas();
            absorbTitles();
            render();
        }
    });

    window.addEventListener('message', onExtensionMessage);

    // Возврат на вкладку подтягивает правки с другого устройства, уход с неё дописывает файл
    window.addEventListener('focus', () => {
        if (disk.status === 'ok' && !document.querySelector('dialog[open]')) diskTask(syncDisk);
        botSync();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && disk.timer) flushDisk();
        if (!document.hidden) botSync(); // На телефоне возврат к вкладке не вызывает focus
    });

    // --- Запуск ---
    if (navigator.userAgentData) root.dataset.liquid = ''; // Chromium умеет SVG-фильтр в backdrop-filter
    applyTheme();
    applyRoute();
    postToExtension({ type: 'hello' });
    startTelegram();
    // Правки с других устройств накладываются на данные с диска, поэтому сначала нужен файл
    restoreFolder().finally(botSync);
    setInterval(() => {
        if (!document.hidden) botSync();
    }, BOT_POLL);

    // Пауза даёт расширению время ответить: через него доступно больше каталогов
    setTimeout(() => {
        if (state.settings.autoCheck && state.settings.lastCheck !== todayStr() && state.mangas.length) {
            checkNewChapters({ silent: true });
        }
    }, 1500);
});
