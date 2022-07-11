import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Navbar } from 'ui-components';
import { MessageType } from 'app';
import { Template } from 'components';
import { Theme } from 'styles';
import { Home } from 'views/home';
import { SupportStatus } from 'device_support';
import { UnsupportedPopup } from './unsupported_popup';
import { SelfDismissingIncentiveModal } from './account/dashboard/modals/incentive_modal';

const FALAFEL_UNREACHABLE_MSG = {
  type: MessageType.ERROR,
  message: 'Cannot reach rollup provider. Please try again later.',
};

type FailureReason = { type: 'unsupported'; supportStatus: SupportStatus } | { type: 'falafel-down' };

interface AppInitFailedProps {
  reason: FailureReason;
  explorerUrl: string;
}

export function AppInitFailed({ reason, explorerUrl }: AppInitFailedProps) {
  const [showingReason, setShowingReason] = useState(false);
  const handleInteraction = () => setShowingReason(true);
  const handleClosePopup = () => setShowingReason(false);
  const { pathname } = useLocation();
  useEffect(() => {
    if (pathname !== '/') handleInteraction();
  }, [pathname]);

  const systemMessage = showingReason && reason.type === 'falafel-down' ? FALAFEL_UNREACHABLE_MSG : undefined;
  return (
    <Template theme={Theme.GRADIENT} systemMessage={systemMessage} explorerUrl={explorerUrl}>
      <Navbar path={window.location.pathname} theme={Theme.GRADIENT} isLoggingIn={false} isLoggedIn={false} />
      <Home onSignup={handleInteraction} />
      {showingReason && reason.type === 'unsupported' && (
        <UnsupportedPopup onClose={handleClosePopup} supportStatus={reason.supportStatus} />
      )}
      <SelfDismissingIncentiveModal instanceName="failure" buttonLabel="Shield now" onButtonClick={handleInteraction} />
    </Template>
  );
}