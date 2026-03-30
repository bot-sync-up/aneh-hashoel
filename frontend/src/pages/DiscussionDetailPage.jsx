import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

/**
 * DiscussionDetailPage — redirects to /discussions?d=:id
 * All discussion functionality lives in the main DiscussionsPage.
 */
export default function DiscussionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    navigate(`/discussions?d=${id}`, { replace: true });
  }, [id, navigate]);

  return null;
}
