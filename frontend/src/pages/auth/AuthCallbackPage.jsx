import { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { FullPageSpinner } from '../../components/ui/Spinner';
import { get } from '../../lib/api';

/**
 * /auth/callback — מקבל accessToken + sessionId מ-Google OAuth redirect,
 * שומר ב-localStorage דרך AuthContext, ומנתב לדשבורד.
 */
export default function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login, persistAuth } = useAuth();

  useEffect(() => {
    const accessToken  = searchParams.get('accessToken');
    const refreshToken = searchParams.get('refreshToken');
    const sessionId    = searchParams.get('sessionId');
    const error        = searchParams.get('error');

    if (error) {
      navigate(`/login?error=${encodeURIComponent(error)}`, { replace: true });
      return;
    }

    if (!accessToken) {
      navigate('/login?error=' + encodeURIComponent('שגיאה בכניסה עם Google'), { replace: true });
      return;
    }

    // שמור את הטוקן ואז שלוף פרופיל
    localStorage.setItem('auth_token', accessToken);

    get('/auth/me')
      .then((data) => {
        const rabbi = data.rabbi || data;
        // Use persistAuth to save to localStorage AND update React state
        persistAuth(rabbi, accessToken, refreshToken);
        // Force page reload to re-initialize AuthContext with the new token
        window.location.href = '/';
      })
      .catch(() => {
        localStorage.removeItem('auth_token');
        navigate('/login?error=' + encodeURIComponent('כניסה עם Google נכשלה'), { replace: true });
      });
  }, []);

  return <FullPageSpinner label="מתחבר עם Google..." />;
}
