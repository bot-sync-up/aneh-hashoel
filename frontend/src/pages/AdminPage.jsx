import React from 'react';
import { Routes, Route } from 'react-router-dom';
import PageHeader from '../components/layout/PageHeader';
import Card from '../components/ui/Card';

function AdminDashboard() {
  return (
    <div className="page-enter">
      <PageHeader
        title="ניהול מערכת"
        subtitle="ניהול משתמשים, הגדרות ונתוני המערכת"
      />
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card hoverable>
          <Card.Title>ניהול רבנים</Card.Title>
          <Card.Description>הוספה, עריכה ומחיקת חשבונות רבנים.</Card.Description>
        </Card>
        <Card hoverable>
          <Card.Title>ניהול קטגוריות</Card.Title>
          <Card.Description>ניהול קטגוריות השאלות במערכת.</Card.Description>
        </Card>
        <Card hoverable>
          <Card.Title>סטטיסטיקות</Card.Title>
          <Card.Description>צפייה בנתוני ביצועים ודוחות.</Card.Description>
        </Card>
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <Routes>
      <Route index element={<AdminDashboard />} />
    </Routes>
  );
}
