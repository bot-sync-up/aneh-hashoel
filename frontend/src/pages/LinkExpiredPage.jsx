import React from 'react';
import { Link } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { LinkIcon, ArrowRight } from 'lucide-react';

export default function LinkExpiredPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-page)] p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
            <LinkIcon size={28} className="text-red-500" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] font-heebo">
            קישור לא תקין
          </h1>
          <p className="text-[var(--text-muted)] text-sm font-heebo mt-1">
            הקישור שלך פג תוקף או שאינו תקין
          </p>
        </div>

        <Card>
          <div className="text-center py-2">
            <p className="text-sm text-[var(--text-secondary)] font-heebo mb-5">
              ייתכן שהקישור פג תוקף. ניתן לבקש קישור חדש דרך דף איפוס הסיסמה.
            </p>
            <div className="flex flex-col gap-3">
              <Link to="/reset-password">
                <Button variant="primary" size="md" className="w-full">
                  בקש קישור חדש
                </Button>
              </Link>
              <Link
                to="/login"
                className="inline-flex items-center justify-center gap-1 text-sm font-medium text-brand-gold hover:text-brand-gold-dark font-heebo"
              >
                <ArrowRight size={14} />
                חזרה לדף הכניסה
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
