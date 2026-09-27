import React, { useState } from 'react';
import './AuthModal.css';

interface AuthModalProps {
    onLogin: (username: string, token: string) => void;
}

const AuthModal: React.FC<AuthModalProps> = ({ onLogin }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        try {
            const endpoint = isLogin ? '/api/login' : '/api/register';
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (!response.ok) {
                setError(data.error || 'Ошибка');
                return;
            }

            if (data.token) {
                onLogin(data.user.username, data.token);
            } else {
                setError(data.message || 'Регистрация успешна! Теперь войдите.');
                setIsLogin(true);
            }
        } catch (err) {
            setError('Ошибка сети');
        }
    };

    return (
        <div className="auth-modal">
            <div className="auth-container">
                <h2>{isLogin ? 'Вход' : 'Регистрация'}</h2>
                <div className="auth-tabs">
                    <button
                        className={`auth-tab ${isLogin ? 'active' : ''}`}
                        onClick={() => setIsLogin(true)}
                    >
                        Вход
                    </button>
                    <button
                        className={`auth-tab ${!isLogin ? 'active' : ''}`}
                        onClick={() => setIsLogin(false)}
                    >
                        Регистрация
                    </button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Логин</label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Введите логин"
                            minLength={3}
                            maxLength={20}
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label>Пароль</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Введите пароль"
                            minLength={4}
                            required
                        />
                    </div>
                    {error && <div className="form-error">{error}</div>}
                    <button type="submit" className="btn btn-full">
                        {isLogin ? 'Войти' : 'Зарегистрироваться'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default AuthModal;
