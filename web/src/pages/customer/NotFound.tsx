import { Link } from 'react-router-dom';
import { Button, EmptyState } from '../../components/ui';

export function NotFound() {
  return <EmptyState emoji="🧭" title="This aisle doesn't exist" text="The page you're looking for isn't here." action={<Link to="/"><Button>Go home</Button></Link>} />;
}
