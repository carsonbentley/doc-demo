'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle, Loader2 } from 'lucide-react';

interface DeleteOrganizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  organizationName: string;
  isDeleting?: boolean;
}

export function DeleteOrganizationModal({
  isOpen,
  onClose,
  onConfirm,
  organizationName,
  isDeleting = false,
}: DeleteOrganizationModalProps) {
  const [confirmationText, setConfirmationText] = useState('');
  const [error, setError] = useState('');

  const isConfirmationValid = confirmationText === organizationName;

  const handleConfirm = async () => {
    if (!isConfirmationValid) {
      setError('Organization name does not match');
      return;
    }

    try {
      setError('');
      await onConfirm();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete organization');
    }
  };

  const handleClose = () => {
    setConfirmationText('');
    setError('');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold text-gray-900">
                Delete Requirement Document
              </DialogTitle>
              <DialogDescription className="text-sm text-gray-500">
                This action cannot be undone.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="rounded-md bg-red-50 p-4">
            <div className="text-sm text-red-800">
              <p className="font-medium mb-2">This will permanently delete:</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>The requirement document "{organizationName}"</li>
                <li>All project records and uploaded files</li>
                <li>All requirement ingestion and chunk records</li>
                <li>All section-to-requirement links and citations</li>
              </ul>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmation" className="text-sm font-medium">
              Type <span className="font-mono bg-gray-100 px-1 rounded">{organizationName}</span> to confirm:
            </Label>
            <Input
              id="confirmation"
              value={confirmationText}
              onChange={(e) => setConfirmationText(e.target.value)}
              placeholder="Enter requirement document name"
              className={error ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}
              disabled={isDeleting}
            />
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!isConfirmationValid || isDeleting}
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              'Delete Requirement Document'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
