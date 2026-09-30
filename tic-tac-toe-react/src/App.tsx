import React, { useEffect, useState } from 'react';
import { useMatch } from './hooks/useMatch';
import Board from './components/Board';
import Scoreboard from './components/Scoreboard';
import Countdown from './components/Countdown';
import MatchResult from './components/MatchResult';
import AuthModal from './components/AuthModal';
import SidePanel from './components/SidePanel';
import ChallengeDialog from './components/ChallengeDialog';
import HelpDialog from './components/HelpDialog';
import { clearToken } from './api';
import { setSoundEnabled } from './signals';
import type { SearchState } from './types';
import './App.css';

/** Сколько партий нужно до рейтинга: столько же считает сервер */
const RATED_UNLOCK_GAMES = 3;

const App: React.FC = () => {
    const [theme, setTheme] = useState<'light' | 'dark'>('light');
    const [showAuth, setShowAuth] = useState(true);
    const [username, setUsername] = useState('');
    const [token, setToken] = useState<string>('');
    const [soundOn, setSoundOn] = useState(true);
    const [showHelp, setShowHelp] = useState(false);
    /* Боковая панель на узком экране прячется за кнопку: иначе она
       отбирает у поля высоту, и доска выходит мелкой */
    const [panelOpen, setPanelOpen] = useState(false);

    const match = useMatch(username);
    const { snapshot, search, played, startBotMatch, findMatch, cancelSearch,
        syncMatch, makeMove, requestRematch } = match;

    // Мой id внутри партии равен нику
    const myId = username || null;

    useEffect(() => {
        const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
        if (savedTheme) setTheme(savedTheme);
        setSoundOn(localStorage.getItem('sound') !== 'off');
    }, []);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    useEffect(() => {
        setSoundEnabled(soundOn);
        localStorage.setItem('sound', soundOn ? 'on' : 'off');
    }, [soundOn]);

    // Восстанавливаем сессию после перезагрузки
    useEffect(() => {
        const savedToken = localStorage.getItem('token');
        const savedUser = localStorage.getItem('username');
        if (savedToken && savedUser) {
            setToken(savedToken);
            setUsername(savedUser);
            setShowAuth(false);
        }
    }, []);

    useEffect(() => {
        if (token) localStorage.setItem('token', token);
        if (username) localStorage.setItem('username', username);
    }, [token, username]);

    // Вернулись на страницу во время партии - забираем состояние
    useEffect(() => {
        if (showAuth) return;
        syncMatch();
    }, [showAuth, syncMatch]);

    // Токен живёт в памяти сервера и умирает при каждом рестарте. Без этой
    // реакции интерфейс просто молчал бы: друзья и рейтинг пустые, вызовы
    // не уходят, и непонятно, что вообще происходит
    useEffect(() => {
        const onExpired = () => {
            clearToken();
            setToken('');
            setUsername('');
            setShowAuth(true);
        };
        window.addEventListener('auth:expired', onExpired);
        return () => window.removeEventListener('auth:expired', onExpired);
    }, []);

    const handleLogin = (user: string, accessToken: string) => {
        // Токен пишем сразу, а не в эффекте. Иначе в том же проходе
        // отрисовки эффект useMatch успевает запросить /api/friends
        // (username уже установлен) ещё до записи токена, получает 401
        // и выкидывает только что вошедшего игрока на экран входа
        localStorage.setItem('token', accessToken);
        localStorage.setItem('username', user);
        setUsername(user);
        setToken(accessToken);
        setShowAuth(false);
    };

    const handleLogout = () => {
        cancelSearch();
        clearToken();
        setToken('');
        setUsername('');
        setShowAuth(true);
    };

    // Реванш: против бота это просто новая партия, против человека -
    // нужно согласие соперника
    const handleRematch = () => {
        if (!snapshot) return;
        const humans = snapshot.players.filter(p => !p.isBot).length;
        if (humans > 1) {
            requestRematch();
            return;
        }
        startBotMatch();
    };

    const inMatch = !!snapshot && snapshot.phase !== 'finished';
    const showGame = !!snapshot;
    const isBotMatch = !!snapshot && snapshot.players.some(p => p.isBot);
    const canPlayRated = played >= RATED_UNLOCK_GAMES;
    const searching = search.status === 'searching';

    // Новая партия - закрываем панель. На узком экране она наезжает на
    // доску, и начинать игру под закрытым полем нельзя. Следим за
    // сменой комнаты, а не за фазой: фаза меняется на каждом ходу.
    const roomId = snapshot ? snapshot.roomId : null;
    useEffect(() => {
        if (roomId) setPanelOpen(false);
    }, [roomId]);

    if (showAuth) {
        return <AuthModal onLogin={handleLogin} />;
    }

    return (
        <div className={`app ${showGame ? 'with-game' : ''}`}>
            {/* Панель и поиск в одном header: игровой экран сделан сеткой, и
                шапка должна занимать ровно одну строку. Иначе при появлении
                панели поиска число строк меняется и вёрстка прыгает */}
            <header className="app-header">
                <TopBar
                    username={username}
                    theme={theme}
                    canStart={!inMatch && match.connected && !searching}
                    canPlayRated={canPlayRated}
                    played={played}
                    onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                    onPlayRated={findMatch}
                    onPlayBot={startBotMatch}
                    onToggleHelp={() => setShowHelp(true)}
                    onToggleSound={() => setSoundOn(v => !v)}
                    soundOn={soundOn}
                    onLogout={handleLogout}
                />

                {searching && (
                    <SearchBar
                        search={search}
                        onCancel={cancelSearch}
                        onPlayBot={startBotMatch}
                    />
                )}
            </header>

            {showGame && (
                <div className="game-area">
                    <div className="container">
                        <Scoreboard snapshot={snapshot} myId={myId} />
                        {/* Итог показываем вместо доски: после партии поле
                            сжималось, и это дёргало вёрстку в тот самый момент,
                            когда игрок жмёт кнопки */}
                        {snapshot.phase === 'finished' ? (
                            <MatchResult
                                snapshot={snapshot}
                                myId={myId}
                                canRematch={match.connected}
                                onRematch={handleRematch}
                                onExit={match.leaveMatch}
                                isBotMatch={isBotMatch}
                            />
                        ) : (
                            <>
                                <Countdown
                                    snapshot={snapshot}
                                    myId={myId}
                                    lastMove={match.lastMove}
                                    offline={!match.connected}
                                />
                                <Board
                                    snapshot={snapshot}
                                    myId={myId}
                                    lastEdge={match.lastMove ? match.lastMove.edge : null}
                                    onMove={makeMove}
                                />
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Затемнение под панелью. Без него выйти из панели можно было
                только кнопкой, а кнопка оказывалась ПОД панелью: закрыв
                панелью доску, игрок терял и способ её закрыть */}
            {panelOpen && <div className="panel-backdrop" onClick={() => setPanelOpen(false)} />}

            {/* На широком экране кнопка скрыта стилями, панель и так видна */}
            <button
                className={`panel-toggle ${panelOpen ? 'is-open' : ''}`}
                onClick={() => setPanelOpen(v => !v)}
                title={panelOpen ? 'Закрыть панель' : 'Список игроков и чат'}
                aria-expanded={panelOpen}
            >
                {panelOpen ? '✕' : '☰'}
            </button>

            <SidePanel
                isOpen={panelOpen}
                onClose={() => setPanelOpen(false)}
                username={username}
                chatMessages={match.messages}
                online={match.online}
                friends={match.friends}
                leaderboard={match.leaderboard}
                connected={match.connected}
                pendingTarget={match.pendingTarget}
                canChallenge={canPlayRated}
                onSendChat={match.sendChat}
                onChallenge={match.sendChallenge}
                onCancelChallenge={match.cancelChallenge}
                onAddFriend={match.addFriend}
                onRemoveFriend={match.removeFriend}
                loadFriends={match.loadFriends}
                loadLeaderboard={match.loadLeaderboard}
            />

            <ChallengeDialog
                challenge={match.incoming}
                rematch={match.rematchRequest}
                notice={match.notice}
                onRespondChallenge={match.respondChallenge}
                onRespondRematch={match.respondRematch}
                onDismissNotice={match.clearNotice}
            />

            {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
        </div>
    );
};

/**
 * Панель подбора соперника. Пока идёт перебор игроков, виден прогресс:
 * без него десять секунд на каждого выглядят как зависание, и человек
 * решает, что игра сломалась.
 */
const SearchBar: React.FC<{
    search: SearchState;
    onCancel: () => void;
    onPlayBot: () => void;
}> = ({ search, onCancel, onPlayBot }) => {
    const [text, setText] = useState('Ищем соперника…');

    useEffect(() => {
        if (search.status === 'idle') {
            setText('Ищем соперника…');
            return;
        }
        if (search.status === 'searching') {
            const total = search.total || 1;
            const left = Math.max(0, total - (search.checked || 0));
            setText(
                search.by
                    ? `Вызов игроку ${search.by}. Проверено ${search.checked} из ${total} — осталось ${left}`
                    : `Проверено ${search.checked} из ${total}`
            );
            return;
        }
        // Поиск закончился: соперников не нашлось. Не предлагаем бота молча -
        // рейтинговая партия и тренировка это разные вещи.
        if (search.reason === 'empty') {
            setText('Сейчас в игре нет других игроков. Можно сыграть с ботом.');
        } else if (search.reason === 'exhausted') {
            setText('Никто не принял вызов. Можно сыграть с ботом.');
        } else if (search.reason === 'locked') {
            setText(`Нужно сыграть ещё партии, чтобы включился рейтинг.`);
        } else {
            setText('Сейчас не получится найти соперника.');
        }
    }, [search]);

    return (
        <div className="search-bar">
            <span className="search-text">{text}</span>
            <button className="btn btn-small btn-ghost" onClick={onCancel}>
                Отмена
            </button>
            <button className="btn btn-small" onClick={onPlayBot}>
                Играть с ботом
            </button>
        </div>
    );
};

interface TopBarProps {
    username: string;
    theme: 'light' | 'dark';
    canStart: boolean;
    canPlayRated: boolean;
    played: number;
    onToggleTheme: () => void;
    onPlayRated: () => void;
    onPlayBot: () => void;
    onToggleHelp: () => void;
    onToggleSound: () => void;
    soundOn: boolean;
    onLogout: () => void;
}

/**
 * Верхняя панель. Кнопки квадратные: иконка сверху, короткая подпись
 * снизу, чтобы панель не меняла высоту и подписи не переносились.
 */
const TopBar: React.FC<TopBarProps> = ({
    username,
    theme,
    canStart,
    canPlayRated,
    played,
    onToggleTheme,
    onPlayRated,
    onPlayBot,
    onToggleHelp,
    onToggleSound,
    soundOn,
    onLogout
}) => (
    <div className="top-bar">
        {/* Ник слева, заголовок по центру, кнопки справа. Порядок в разметке
            именно такой: центрирование сделано сеткой из трёх колонок, где
            крайние одинаковые, иначе заголовок уезжал бы от центра */}
        <span className="top-bar-user">{username}</span>
        <span className="top-bar-title">Точки и квадраты</span>
        <div className="top-bar-actions">
            <button
                className="btn-square btn-square-primary"
                onClick={onPlayRated}
                disabled={!canStart || !canPlayRated}
                title={
                    !canPlayRated
                        ? `Сыграйте ещё ${RATED_UNLOCK_GAMES - played} партии — и рейтинг откроется`
                        : 'Найти соперника на рейтинг'
                }
            >
                <span className="ico">⚔</span>
                <span className="cap">Играть</span>
            </button>
            <button
                className="btn-square"
                onClick={onPlayBot}
                disabled={!canStart}
                title="Партия с ботом, рейтинг не изменится"
            >
                <span className="ico">🎮</span>
                <span className="cap">Бот</span>
            </button>
            <button
                className="btn-square"
                onClick={onToggleTheme}
                title="Сменить тему"
            >
                <span className="ico">{theme === 'light' ? '🌙' : '☀️'}</span>
                <span className="cap">Тема</span>
            </button>
            <button
                className="btn-square"
                onClick={onToggleHelp}
                title="Как играть"
            >
                <span className="ico">📖</span>
                <span className="cap">Правила</span>
            </button>
            <button
                className="btn-square"
                onClick={onToggleSound}
                title={soundOn ? 'Выключить звук' : 'Включить звук'}
            >
                <span className="ico">{soundOn ? '🔊' : '🔇'}</span>
                <span className="cap">Звук</span>
            </button>
            <button
                className="btn-square btn-square-ghost"
                onClick={onLogout}
                disabled={!canStart}
                title={
                    canStart
                        ? 'Выйти из аккаунта'
                        : 'Нельзя выйти во время партии или без связи с сервером'
                }
            >
                <span className="ico">🚪</span>
                <span className="cap">Выход</span>
            </button>
        </div>
    </div>
);

export default App;
