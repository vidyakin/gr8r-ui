/* Оверлеи приложения: карточка задачи и формы. Каждый открывается своим хуком из любого места,
   поэтому вызывающему коду не нужно знать, где и как рисуется окно. */
import * as React from 'react';
import { InviteProvider } from './invite';
import { PaletteProvider } from './palette';
import { ProjectFormsProvider } from './project-forms';
import { TaskDrawerProvider } from './task-drawer';
import { TaskFormProvider } from './task-form';
import { TeamFormProvider } from './team-form';

export function OverlayProviders({ children }: { children: React.ReactNode }) {
  return (
    <TaskDrawerProvider>
      <TaskFormProvider>
        <ProjectFormsProvider>
          <InviteProvider>
            <TeamFormProvider>
              <PaletteProvider>{children}</PaletteProvider>
            </TeamFormProvider>
          </InviteProvider>
        </ProjectFormsProvider>
      </TaskFormProvider>
    </TaskDrawerProvider>
  );
}

export { useTaskDrawer } from './task-drawer';
export { useTaskForm, type TaskDefaults } from './task-form';
export { useProjectForms } from './project-forms';
export { useInvite } from './invite';
export { useTeamForm } from './team-form';
export { PaletteHost, usePalette } from './palette';
