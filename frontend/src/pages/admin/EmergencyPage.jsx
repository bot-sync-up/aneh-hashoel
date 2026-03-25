import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import Button from '../../components/ui/Button';
import EmergencyModal from '../../components/admin/EmergencyModal';

export default function EmergencyPage() {
  const [emergencyMsg, setEmergencyMsg] = useState('');
  const [showEmergency, setShowEmergency] = useState(false);

  return (
    <div className="space-y-5 max-w-2xl" dir="rtl">
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)] font-heebo">שידור חירום</h2>
        <p className="text-sm text-[var(--text-muted)] font-heebo mt-0.5">
          שלח הודעה מיידית לכל הרבנים הפעילים בכל הערוצים
        </p>
      </div>

      <div className="rounded-xl border-2 border-red-200 bg-red-50/40 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-red-200 bg-red-50">
          <AlertTriangle size={18} className="text-red-600" />
          <div>
            <h3 className="font-bold text-red-700 font-heebo text-sm">שידור הודעת חירום</h3>
            <p className="text-xs text-red-500 font-heebo mt-0.5">
              ההודעה תישלח מיידית לכל הרבנים הפעילים בכל הערוצים
            </p>
          </div>
        </div>
        <div className="px-6 py-5 space-y-4">
          <textarea
            value={emergencyMsg}
            onChange={(e) => setEmergencyMsg(e.target.value)}
            rows={6}
            placeholder="כתוב כאן את הודעת החירום שתישלח לכל הרבנים..."
            className="w-full px-3 py-3 rounded-lg border border-red-200 bg-white text-sm font-heebo text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)] font-heebo">
              {emergencyMsg.length} / 500 תווים
            </span>
            <Button
              variant="danger"
              disabled={!emergencyMsg.trim() || emergencyMsg.length > 500}
              onClick={() => setShowEmergency(true)}
              leftIcon={<AlertTriangle size={15} />}
            >
              שלח לכל הרבנים
            </Button>
          </div>
        </div>
      </div>

      <EmergencyModal
        isOpen={showEmergency}
        message={emergencyMsg}
        onClose={() => setShowEmergency(false)}
      />
    </div>
  );
}
