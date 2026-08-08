// Skills Feature
// Entry point for the skills management feature

// Pages
export { default as SkillsPage } from './pages/SkillsPage';

// Modals
export { AddSkillModal } from './components/modals/AddSkillModal';
export { GitPickModal } from './components/modals/GitPickModal';
export { DeleteConfirmModal } from './components/modals/DeleteConfirmModal';
export { ImportModal } from './components/modals/ImportModal';
export { SkillsSettingsModal } from './components/modals/SkillsSettingsModal';

// Hooks
export { useSkills } from './hooks/useSkills';
export { useSkillActions } from './hooks/useSkillActions';

// Utils
export {
  isSkillExistsError,
  extractSkillName,
  showGitError,
  confirmSkillOverwrite,
  confirmTargetOverwrite,
  confirmBatchOverwrite,
} from './utils/errorHandlers';
export { syncSkillToTools } from './utils/syncHelpers';

// Store
export { useSkillsStore } from './stores/skillsStore';

// Types
export type {
  ManagedSkill,
  SkillTarget,
  ToolInfo,
  GitSkillCandidate,
  OnboardingPlan,
} from './types';
