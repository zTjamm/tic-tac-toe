/**
 * Единая обёртка над fetch для запросов к своему API.
 *
 * Токен живёт в памяти сервера, поэтому после перезапуска он становится
 * недействительным. Раньше это выглядело как «вс�� сломалось»: друзья и
 * рейтинг молча приходили пустыми, а чат и вызовы падали в консоль.
 * Теперь такой случай один раз сообщает приложению, что пора войти снова.
 */

const TOKEN_KEY = 'token';

let notified = false;

function notifyExpired() {
    if (notified) return;
    notified = true;
    window.dispatchEvent(new CustomEvent('auth:expired'));
    // Следующий успешный вход снова разрешит показывать уведомление
    window.setTimeout(() => { notified = false; }, 1000);
}

interface ApiOptions {
    method?: string;
    body?: unknown;
    /** не прикреплять токен (регистрация, вход) */
    anonymous?: boolean;
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
    const headers: Record<string, string> = {};
    let payload: string | undefined;

    if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(options.body);
    }
    if (!options.anonymous) {
        const token = localStorage.getItem(TOKEN_KEY) || '';
        if (token) headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(path, {
        method: options.method || 'GET',
        headers,
        body: payload
    });

    // Разлогинивать имеет смысл, только если токен действительно был
    // предъявлен и сервер его отверг. 401 без токена - это не истёкшая
    // сессия: сразу после входа состояние React уже обновилось, а токен
    // ещё не записан в localStorage, и первый запрос уходил без него
    const sentToken = !!headers.Authorization;
    if (res.status === 401 && !options.anonymous && sentToken) {
        notifyExpired();
    }

    const data = await res.json().catch(() => null);
    if (!res.ok) {
        const message = data && typeof data.error === 'string' ? data.error : `Ошибка ${res.status}`;
        const err = new Error(message) as Error & { status?: number };
        err.status = res.status;
        throw err;
    }
    return data as T;
}

export function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('username');
}
