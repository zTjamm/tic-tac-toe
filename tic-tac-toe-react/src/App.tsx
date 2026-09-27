import React, { useEffect, useState } from 'react';
import { useMatch } from './hooks/useMatch';
import Board from './components/Board';
import Scoreboard from './components/Scoreboard';
import Countdown from './components/Countdown';
import MatchResult from './components/MatchResult';
import AuthModal from './components/AuthModal';
import SidePanel from './components/SidePanel';
import './App.css';

const App: React.FC = () => {
    const [theme, setTheme] = useState<'light' | 'dark'>('light');
    const [showAuth, setShowAuth] = useState(true);
    const [username, setUsername] = useState('');
    const [token, setToken] = useState<string>('');

    const match = useMatch(username);
    const { snapshot, startBotMatch, syncMatch, pickNumber, chooseRole, makeMove, clearMatch } =
        match;

    // Мой id внутри матча равен нику
    const myId = username || null;

    useEffect(() => {
        const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
        if (savedTheme) setTheme(savedTheme);
    }, []);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

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

    const handleLogin = (user: string, accessToken: string) => {
        setUsername(user);
        setToken(accessToken);
        setShowAuth(false);
    };

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
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
            // пока сетевой реванш не реализован - честно говорим об этом
            window.alert('Реванш по сети скоро появится. Пока можно сыграть с ботом.');
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
                onLogout={handleLogout}
            />

            {showGame && (
                <div className="game-area">
                    <div className="container">
                        <Scoreboard snapshot={snapshot} myId={myId} />
                        <Countdown
                            snapshot={snapshot}
                            myId={myId}
                            onChooseRole={chooseRole}
                        />
                        {/* Итог показываем над доской: кнопки реванша и выхода
                            должны быть видны без прокрутки, доска нужна лишь
                            как запись последнего раунда */}
                        {snapshot.phase === 'finished' && (
                            <MatchResult
                                snapshot={snapshot}
                                myId={myId}
                                canRematch={match.connected}
                                onRematch={handleRematch}
                                onExit={clearMatch}
                            />
                        )}

                        <Board
                            snapshot={snapshot}
                            myId={myId}
                            onPickNumber={pickNumber}
                            onMove={makeMove}
                        />
                    </div>
                </div>
            )}

            <SidePanel
                username={username}
                chatMessages={match.messages}
                connected={match.connected}
                onSendChat={match.sendChat}
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
    onLogout: () => void;
}

const TopBar: React.FC<TopBarProps> = ({
    username,
    theme,
    canStart,
    onToggleTheme,
    onStartBot,
    onLogout
}) => (
    <div className="top-bar">
        <span className="top-bar-title">Крестики-нолики</span>
        <div className="top-bar-actions">
            <button className="btn btn-top" onClick={onStartBot} disabled={!canStart}>
                Игра против бота
            </button>
            <button
                className="btn btn-top btn-icon"
                onClick={onToggleTheme}
                title="Сменить тему"
            >
                {theme === 'light' ? '🌙' : '☀️'}
            </button>
            <button
                className="btn btn-top btn-logout"
                onClick={onLogout}
                disabled={!canStart}
                title={
                    canStart
                        ? 'Выйти из аккаунта'
                        : 'Нельзя выйти во время матча или без связи с сервером'
                }
            >
                Выход
            </button>
        </div>
        <span className="top-bar-user">{username}</span>
    </div>
);

export default App;
