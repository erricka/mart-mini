import { Link } from 'react-router-dom';
import { Button, EmptyState } from '../../components/ui';
import { useT } from '../../lib/i18n';

export function NotFound() {
  const { t } = useT();
  return <EmptyState emoji="🧭" title={t('nf.title')} text={t('nf.text')} action={<Link to="/"><Button>{t('common.go_home')}</Button></Link>} />;
}
