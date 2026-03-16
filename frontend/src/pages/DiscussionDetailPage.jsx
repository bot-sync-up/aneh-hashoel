import React from 'react';
import { useParams } from 'react-router-dom';
import PageHeader, { Breadcrumb } from '../components/layout/PageHeader';
import Card from '../components/ui/Card';

export default function DiscussionDetailPage() {
  const { id } = useParams();

  return (
    <div className="page-enter">
      <PageHeader
        title="פרטי דיון"
        breadcrumb={
          <Breadcrumb
            items={[
              { label: 'דיונים', href: '/discussions' },
              { label: `דיון #${id}` },
            ]}
          />
        }
      />
      <div className="p-6">
        <Card>
          <Card.Title>דיון #{id}</Card.Title>
          <Card.Description>
            פרטי הדיון יוצגו כאן.
          </Card.Description>
        </Card>
      </div>
    </div>
  );
}
