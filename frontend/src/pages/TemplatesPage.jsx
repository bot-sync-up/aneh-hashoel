import React from 'react';
import PageHeader from '../components/layout/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import { FileText } from 'lucide-react';

export default function TemplatesPage() {
  return (
    <div className="page-enter">
      <PageHeader
        title="תבניות"
        subtitle="ניהול תבניות תשובה מוכנות"
      />
      <div className="p-6">
        <EmptyState
          icon={FileText}
          title="אין תבניות"
          description="צור תבניות תשובה מוכנות לשימוש חוזר."
          actionLabel="צור תבנית חדשה"
          onAction={() => {}}
        />
      </div>
    </div>
  );
}
