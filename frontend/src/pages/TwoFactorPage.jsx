import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Card from '../components/ui/Card';
import { ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api';

export default function TwoFactorPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!code.trim() || code.length < 4) {
      toast.error('אנא הזן קוד תקין');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/2fa/verify', { code });
      toast.success('אימות דו-שלבי הצליח');
      navigate('/');
    } catch (err) {
      toast.error(err.response?.data?.message || 'קוד שגוי. אנא נסה שוב.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-page)] p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-brand-navy mb-4">
            <ShieldCheck size={28} className="text-brand-gold" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] font-heebo">
            אימות דו-שלבי
          </h1>
          <p className="text-[var(--text-muted)] text-sm font-heebo mt-1">
            הזן את הקוד שנשלח אליך
          </p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <Input
              label="קוד אימות"
              type="text"
              name="code"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="000000"
              className="text-center tracking-[0.5em] text-lg"
              maxLength={6}
              required
            />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              className="w-full"
            >
              אמת קוד
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
