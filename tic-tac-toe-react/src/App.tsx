import React, { useState, useEffect } from 'react';
import { useGame } from './hooks/useGame';
import { useOnlineGame } from './hooks/useOnlineGame';
import Board from './components/Board';
import Scoreboard from './components/Scoreboard';
import AuthModal from './components/AuthModal';
import SidePanel from './components/SidePanel';
import './App.css';

const App: React.FC = () => {
    const [theme, setTheme] = useState<'light' | 'dark'>('light');
    const [showAuth, setShowAuth] = useState(true);
    const [username, setUsername] = useState('');
    const [token, setToken] = useState<string | null>(null);
    const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
    const [chatMessages, setChatMessages] = useState<Array<{ sender: string; text: string }>>([]);
    const [showGame, setShowGame] = useState(false);

    const game = useGame();
    // Пустая строка = тот же origin, что и страница (порт 3000)
    const onlineGame = useOnlineGame('', username);

    useEffect(() => {
        const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
        if (savedTheme) setTheme(savedTheme);
    }, []);

    // Восстанавливаем сессию после перезагрузки страницы
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

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    useEffect(() => {
        if (onlineGame.isConnected) {
            setOnlineUsers(prev => {
                if (!prev.includes(username)) {
                    return [...prev, username];
                }
                return prev;
            });
        }
    }, [onlineGame.isConnected, username]);

    useEffect(() => {
        if (onlineGame.messages.length > 0) {
            const latest = onlineGame.messages[onlineGame.messages.length - 1];
            setChatMessages(prev => [...prev, { sender: latest.sender, text: latest.text }]);
        }
    }, [onlineGame.messages]);

    const handleLogin = (user: string, accessToken: string) => {
        setUsername(user);
        setToken(accessToken);
        setShowAuth(false);
    };

    const handleStartBot = () => {
        game.setGameMode('bot');
        game.setPlayerNames({ X: username || 'Игрок', O: 'Бот' });
        setShowGame(true);
    };

    const handleCellClick = (index: number) => {
        if (game.mode === 'bot' && game.currentPlayer === 'O') return;
        if (game.mode === 'online') {
            onlineGame.makeMove(index);
            return;
        }
        game.makeMove(index);
    };

    const handleCloseGame = () => {
        setShowGame(false);
        game.resetGame();
    };

    if (showAuth) {
        return <AuthModal onLogin={handleLogin} />;
    }

    return (
        <div className="app">
            <div className="theme-toggle">
                <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
                    {theme === 'light' ? '🌙' : '☀️'}
                </button>
            </div>

            {showGame && (
                <div className="game-area">
                    <div className="container">
                    <h1>Крестики-нолики</h1>
                    <Scoreboard
                        scores={game.scores}
                        labelX={`Игрок X (${game.playerNames.X})`}
                        labelO={`Игрок O (${game.playerNames.O})`}
                    />
                    <div className={`status ${game.gameActive ? `${game.currentPlayer.toLowerCase()}-turn` : ''}`}>
                        {game.gameActive ? `Ход: ${game.currentPlayer} (${game.playerNames[game.currentPlayer]})` : 'Игра окончена'}
                    </div>
                    <Board
                        board={game.board}
                        onCellClick={handleCellClick}
                        disabled={!game.gameActive || (game.mode === 'bot' && game.currentPlayer === 'O')}
                        winPattern={game.winPattern}
                    />
                    <div className="controls">
                        <button className="btn" onClick={game.resetGame}>Новая игра</button>
                        <button className="btn" onClick={game.resetScore}>Сбросить счёт</button>
                        <button className="btn" onClick={handleCloseGame}>Закрыть игру</button>
                    </div>
                    </div>
                </div>
            )}

            <SidePanel
                username={username}
                onlineUsers={onlineUsers}
                chatMessages={chatMessages}
                onStartBot={handleStartBot}
                onSendChat={onlineGame.sendChatMessage}
                onSendChallenge={onlineGame.sendChallenge}
            />
        </div>
    );
};

export default App;
