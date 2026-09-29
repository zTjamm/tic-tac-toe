import React, { useEffect, useState } from 'react';
import { useMatch } from './hooks/useMatch';
import Board from './components/Board';
import Scoreboard from './components/Scoreboard';
import Countdown from './components/Countdown';
import MatchResult from './components/MatchResult';
import AuthModal from './components/AuthModal';
import SidePanel from './components/SidePanel';
import ChallengeDialog from './components/ChallengeDialog';
import { clearToken } from './api';
import { setSoundEnabled } from './signals';
import './App.css';

const App: React.FC = () => {
    const [theme, setTheme] = useState<'light' | 'dark'>('light');
    const [showAuth, setShowAuth] = useState(true);
    const [username, setUsername] = useState('');
    const [token, setToken] = useState<string>('');
    const [soundOn, setSoundOn] = useState(true);

    const match = useMatch(username);
    const { snapshot, startBotMatch, syncMatch, pickNumber, chooseRole, makeMove,
        requestRematch } = match;

    // Мой id внутри матча равен нику
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

    // Вернулись на страницу во время матча - забираем состояние
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
        clearToken();
        setToken('');
        setUsername('');
        setShowAuth(true);
    };

    // Реванш: для матча с ботом это просто новый матч. Сетевой реванш
    // требует вызова сопернику - он пока не реализован.
    const handleRematch = () => {
        if (!snapshot) return;
        // Считаем именно двух живых игроков: сам игрок тоже не бот,
        // поэтому some(p => !p.isBot) всегда истинно.
        const humans = snapshot.players.filter(p => !p.isBot).length;
        if (humans > 1) {
            // Сетевой реванш требует согласия соперника
            requestRematch();
            return;
        }
        startBotMatch();
    };

    const inMatch = !!snapshot && snapshot.phase !== 'finished';
    const showGame = !!snapshot;

    if (showAuth) {
        return <AuthModal onLogin={handleLogin} />;
    }

    return (
        <div className={`app ${showGame ? 'with-game' : ''}`}>
            <TopBar
                username={username}
                theme={theme}
                canStart={!inMatch && match.connected}
                onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                onStartBot={startBotMatch}
                onToggleSound={() => setSoundOn(v => !v)}
                soundOn={soundOn}
                onLogout={handleLogout}
            />

            {showGame && (
                <div className="game-area">
                    <div className="container">
                        <Scoreboard snapshot={snapshot} myId={myId} />
                        {/* Итог показываем вместо доски: после матча поле
                            сжималось (45vh -> 30vh), и это дёргало вёрстку
                            в тот самый момент, когда игрок жмёт кнопки.
                            Теперь наверху только статистика и действия */}
                        {snapshot.phase === 'finished' ? (
                            <MatchResult
                                snapshot={snapshot}
                                myId={myId}
                                canRematch={match.connected}
                                onRematch={handleRematch}
                                onExit={match.leaveMatch}
                            />
                        ) : (
                            <>
                                <Countdown
                                    snapshot={snapshot}
                                    myId={myId}
                                    roundEnd={match.lastRoundEnd}
                                    offline={!match.connected}
                                    onChooseRole={chooseRole}
                                />
                                <Board
                                    snapshot={snapshot}
                                    myId={myId}
                                    winPattern={match.winPattern}
                                    onPickNumber={pickNumber}
                                    onMove={makeMove}
                                />
                            </>
                        )}
                    </div>
                </div>
            )}

            <SidePanel
                username={username}
                chatMessages={match.messages}
                online={match.online}
                friends={match.friends}
                leaderboard={match.leaderboard}
                connected={match.connected}
                pendingTarget={match.pendingTarget}
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
        </div>
    );
};

interface TopBarProps {
    username: string;
    theme: 'light' | 'dark';
    canStart: boolean;
    onToggleTheme: () => void;
    onStartBot: () => void;
    onToggleSound: () => void;
    soundOn: boolean;
    onLogout: () => void;
}

/**
 * Верхняя панель. Кнопки квадратные: иконка сверху, короткая подпись
 * снизу. Раньше «Игра против бота» переносилась на две строки, от чего
 * панель меняла высоту, а кнопки разной ширины разъезжались.
 */
const TopBar: React.FC<TopBarProps> = ({
    username,
    theme,
    canStart,
    onToggleTheme,
    onStartBot,
    onToggleSound,
    soundOn,
    onLogout
}) => (
    <div className="top-bar">
        <span className="top-bar-title">Крестики-нолики</span>
        <div className="top-bar-actions">
            <button
                className="btn-square btn-square-primary"
                onClick={onStartBot}
                disabled={!canStart}
                title={canStart ? 'Игра против бота' : 'Нельзя начать матч во время игры'}
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
                onClick={onToggleSound}
                title={
                    soundOn
                        ? 'Выключить звук о ходе'
                        : 'Включить звук о ходе'
                }
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
                        : 'Нельзя выйти во время матча или без связи с сервером'
                }
            >
                <span className="ico">🚪</span>
                <span className="cap">Выход</span>
            </button>
        </div>
        <span className="top-bar-user">{username}</span>
    </div>
);

export default App;
