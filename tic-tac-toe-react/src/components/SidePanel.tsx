import React, { useEffect, useState } from 'react';
import type { ChatMessage, OnlineUser, Friend, LeaderboardEntry } from '../types';
import './SidePanel.css';

interface SidePanelProps {
    /** открыта ли панель на узком экране, где она свёрстана в оверлей */
    isOpen: boolean;
    onClose: () => void;
    username: string;
    chatMessages: ChatMessage[];
    online: OnlineUser[];
    friends: Friend[];
    leaderboard: LeaderboardEntry[];
    connected: boolean;
    /** вызов отправлен и ждём ответа */
    pendingTarget: string | null;
    /** открыт ли рейтинговый вызов: пока нет, кнопки вызова заблокированы */
    canChallenge: boolean;
    onSendChat: (text: string) => void;
    onChallenge: (target: string) => void;
    onCancelChallenge: () => void;
    onAddFriend: (name: string) => void;
    onRemoveFriend: (name: string) => void;
    /** стабильные загрузчики: если они меняются на каждом рендере,
        эффект ниже начнёт перезапрашивать данные бесконечно */
    loadFriends: () => void;
    loadLeaderboard: () => void;
}

type Tab = 'online' | 'friends' | 'rating';

const SidePanel: React.FC<SidePanelProps> = ({
    isOpen,
    onClose,
    username,
    chatMessages,
    online,
    friends,
    leaderboard,
    connected,
    pendingTarget,
    canChallenge,
    onSendChat,
    onChallenge,
    onCancelChallenge,
    onAddFriend,
    onRemoveFriend,
    loadFriends,
    loadLeaderboard
}) => {
    const [activeTab, setActiveTab] = useState<Tab>('online');
    const [chatInput, setChatInput] = useState('');
    const [friendInput, setFriendInput] = useState('');

    // Данные вкладок меняются после каждого матча, поэтому тянем их при
    // открытии, а не один раз при загрузке страницы
    useEffect(() => {
        if (activeTab === 'rating') loadLeaderboard();
    }, [activeTab, loadLeaderboard]);

    useEffect(() => {
        if (activeTab === 'friends') loadFriends();
    }, [activeTab, loadFriends]);

    const handleSendChat = () => {
        const text = chatInput.trim();
        if (text) {
            onSendChat(text);
            setChatInput('');
        }
    };

    const handleAddFriend = () => {
        const name = friendInput.trim();
        if (!name) return;
        onAddFriend(name);
        setFriendInput('');
    };

    // Себя ставим первым: счётчик «Онлайн: N» в шапке считает и меня, и
    // список, поэтому число строк теперь совпадает с числом в шапке
    const myEntry = online.find(u => u.username === username) || null;
    const others = online.filter(u => u.username !== username);

    return (
        <div className={`side-panel ${isOpen ? 'is-open' : ''}`}>
            {/* Чат рисуется ВСЕГДА, а не только на вкладке «Онлайн». Раньше на
            остальных вкладках он пропадал, колонка списка разворачивалась с
            38% на всю ширину, и вкладки со списком прыгали при переключении.
            Постоянная раскладка колонок убирает прыжок целиком */}
        <div className="side-body">
                <div className="side-list">
                    <div className="side-tabs">
                        <button
                            className={`side-tab ${activeTab === 'online' ? 'active' : ''}`}
                            onClick={() => setActiveTab('online')}
                        >
                            Онлайн
                        </button>
                        {/* Видна только когда панель свёрстана в оверлей */}
                        <button
                            className="side-close"
                            onClick={onClose}
                            title="Закрыть панель"
                        >
                            ✕
                        </button>
                        <button
                            className={`side-tab ${activeTab === 'friends' ? 'active' : ''}`}
                            onClick={() => setActiveTab('friends')}
                        >
                            Друзья
                        </button>
                        <button
                            className={`side-tab ${activeTab === 'rating' ? 'active' : ''}`}
                            onClick={() => setActiveTab('rating')}
                        >
                            Рейтинг
                        </button>
                    </div>

                    {/* key обязателен: анимация появления перезапускается
                        только при пересоздании элемента, а без него она
                        отработает один раз и на других вкладках не будет */}
                    <div className="side-scroll" key={activeTab}>
                        {activeTab === 'online' && (
                            <div className="online-section">
                                <div className="online-header">
                                    Онлайн: {online.length}
                                    {!connected && <span className="offline-note">нет связи</span>}
                                </div>

                                <ul className="online-list">
                                    {myEntry && (
                                        <li className="online-item is-self">
                                            <div className="online-row">
                                                <span className="online-dot" />
                                                <div className="online-info">
                                                    <div className="online-name">
                                                        {username}
                                                        <span className="you-tag">это вы</span>
                                                    </div>
                                                    <div className="online-rating">
                                                        рейтинг {myEntry.rating}
                                                        {myEntry.strikes > 0 && (
                                                            <span className="strike-tag">
                                                                страйки {myEntry.strikes}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </li>
                                    )}

                                    {others.length === 0 && !myEntry && (
                                        <li className="online-empty">Никого не видно</li>
                                    )}

                                    {others.map(u => {
                                        const pending = pendingTarget === u.username;
                                        const isFriend = friends.some(
                                            f => f.username === u.username
                                        );
                                        return (
                                            <li key={u.username} className="online-item">
                                                <div className="online-row">
                                                    <span className="online-dot" />
                                                    <div className="online-info">
                                                        <div className="online-name">
                                                            {u.username}
                                                        </div>
                                                        <div className="online-rating">
                                                            рейтинг {u.rating}
                                                            {u.strikes > 0 && (
                                                                <span className="strike-tag">
                                                                    страйки {u.strikes}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {pending ? (
                                                        // Отправленный вызов можно
                                                        // отозвать, а не ждать вечно
                                                        <button
                                                            className="btn-online-challenge is-pending"
                                                            onClick={onCancelChallenge}
                                                            title="Отозвать вызов"
                                                        >
                                                            отозвать
                                                        </button>
                                                    ) : (
                                                        <button
                                                            className="btn-online-challenge"
                                                            disabled={u.inMatch || !canChallenge}
                                                            onClick={() => onChallenge(u.username)}
                                                            title={
                                                                !canChallenge
                                                                    ? 'Сыграйте несколько партий, чтобы открылся рейтинг'
                                                                    : u.inMatch
                                                                      ? 'Игрок уже играет'
                                                                      : 'Вызвать на игру'
                                                            }
                                                        >
                                                            {u.inMatch ? 'играет' : 'вызвать'}
                                                        </button>
                                                    )}
                                                </div>
                                                <button
                                                    className={`btn-friend-toggle ${
                                                        isFriend ? 'is-friend' : ''
                                                    }`}
                                                    onClick={() =>
                                                        isFriend
                                                            ? onRemoveFriend(u.username)
                                                            : onAddFriend(u.username)
                                                    }
                                                    title={
                                                        isFriend
                                                            ? 'Убрать из друзей'
                                                            : 'Добавить в друзья'
                                                    }
                                                >
                                                    {isFriend ? '✓ в друзьях' : '+ в друзья'}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        )}

                        {activeTab === 'friends' && (
                            <div className="friends-section">
                                <div className="online-header">Друзья: {friends.length}</div>

                                {/* Добавление по нику: незнакомого игрока может
                                    не быть в онлайне, но он мог сыграть раньше */}
                                <div className="friend-add">
                                    <input
                                        type="text"
                                        placeholder="Ник для добавления"
                                        value={friendInput}
                                        onChange={e => setFriendInput(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleAddFriend()}
                                        maxLength={20}
                                    />
                                    <button className="btn-small" onClick={handleAddFriend}>
                                        +
                                    </button>
                                </div>

                                {friends.length === 0 ? (
                                    <p className="side-hint">
                                        Список пуст. Добавьте игрока по нику или кнопкой
                                        «+ в друзья» в списке онлайна.
                                    </p>
                                ) : (
                                    <ul className="online-list">
                                        {friends.map(f => {
                                            const pending = pendingTarget === f.username;
                                            const busy = !f.online || f.inMatch;
                                            return (
                                                <li key={f.username} className="online-item">
                                                    <div className="online-row">
                                                        <span
                                                            className={`online-dot ${
                                                                f.online ? '' : 'offline'
                                                            }`}
                                                        />
                                                        <div className="online-info">
                                                            <div className="online-name">
                                                                {f.username}
                                                            </div>
                                                            <div className="online-rating">
                                                                рейтинг {f.rating}
                                                                {f.strikes > 0 && (
                                                                    <span className="strike-tag">
                                                                        страйки {f.strikes}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {pending ? (
                                                            <button
                                                                className="btn-online-challenge is-pending"
                                                                onClick={onCancelChallenge}
                                                                title="Отозвать вызов"
                                                            >
                                                                отозвать
                                                            </button>
                                                        ) : (
                                                            <button
                                                                className="btn-online-challenge"
                                                                disabled={busy || !canChallenge}
                                                                onClick={() =>
                                                                    onChallenge(f.username)
                                                                }
                                                                title={
                                                                    !canChallenge
                                                                        ? 'Сыграйте несколько партий, чтобы открылся рейтинг'
                                                                        : !f.online
                                                                          ? 'Игрок не в сети'
                                                                          : f.inMatch
                                                                              ? 'Игрок уже играет'
                                                                              : 'Вызвать на игру'
                                                                }
                                                            >
                                                                {f.inMatch
                                                                    ? 'играет'
                                                                    : pending
                                                                      ? 'ждём'
                                                                      : 'вызвать'}
                                                            </button>
                                                        )}
                                                    </div>
                                                    <button
                                                        className="btn-friend-toggle is-friend"
                                                        onClick={() => onRemoveFriend(f.username)}
                                                        title="Убрать из друзей"
                                                    >
                                                        ✕ убрать
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>
                        )}

                        {activeTab === 'rating' && (
                            <div className="leaderboard-section">
                                <div className="online-header">Таблица лидеров</div>

                                {leaderboard.length === 0 ? (
                                    <p className="side-hint">
                                        Пока никто не играл. Рейтинг начисляется по итогам матча.
                                    </p>
                                ) : (
                                    <ol className="leaderboard">
                                        {leaderboard.map((e, i) => (
                                            <li
                                                key={e.username}
                                                className={`leaderboard-row ${
                                                    e.username === username ? 'me' : ''
                                                }`}
                                            >
                                                <span className="place">{i + 1}</span>
                                                <span className="who">
                                                    {e.username}
                                                    {e.username === username && ' (вы)'}
                                                </span>
                                                <span className="record">
                                                    {e.wins}П {e.losses}П
                                                </span>
                                                <span className="points">{e.rating}</span>
                                            </li>
                                        ))}
                                    </ol>
                                )}
                                <p className="side-hint leaderboard-note">
                                    Ничьих в матче не бывает, поэтому в счёте их нет.
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                <div className="chat-section">
                        <div className="chat-header">Общий чат</div>
                        <div className="chat-messages">
                            {chatMessages.length === 0 && (
                                <p className="chat-empty">Сообщений пока нет</p>
                            )}
                            {chatMessages.map((msg, i) => (
                                <div
                                    key={i}
                                    className={`chat-message ${
                                        msg.sender === username ? 'own' : 'other'
                                    }`}
                                >
                                    <div className="sender">{msg.sender}</div>
                                    <div className="text">{msg.text}</div>
                                </div>
                            ))}
                        </div>
                        <div className="chat-input">
                            <input
                                type="text"
                                placeholder="Сообщение всем..."
                                value={chatInput}
                                onChange={e => setChatInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleSendChat()}
                                maxLength={200}
                            />
                            <button className="btn-small" onClick={handleSendChat}>
                                ➤
                            </button>
                        </div>
                </div>
            </div>
        </div>
    );
};

export default SidePanel;
