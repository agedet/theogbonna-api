import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

/**
 * Uploads receipt files to Cloudinary.
 *
 * Setup (one-time — ~2 minutes):
 *   1. Sign up at https://cloudinary.com (free tier is plenty)
 *   2. From your dashboard copy Cloud Name, API Key, API Secret
 *   3. Paste them into .env as CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET
 *   4. Optionally create a folder called "receipts" in your Media Library
 *      and set CLOUDINARY_FOLDER=receipts (defaults to "ogbonna-receipts")
 */
@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key:    process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure:     true,
    });
  }

  /**
   * Uploads a buffer to Cloudinary and returns the secure public URL.
   *
   * File is stored as: `{folder}/{FirstName_LastName}_{orderId}_{timestamp}`
   * PDFs are uploaded as `raw` resource type so they remain downloadable.
   */
  async uploadReceipt(params: {
    buffer:    Buffer;
    mimetype:  string;
    filename:  string;
    orderId:   string;
    fullName:  string;   // buyer's full name — embedded in the Cloudinary public_id
  }): Promise<string> {
    const folder  = process.env.CLOUDINARY_FOLDER ?? 'ogbonna-receipts';
    const isPdf   = params.mimetype === 'application/pdf';

    // Sanitise name: "Chukwuemeka Ogbonna" → "Chukwuemeka_Ogbonna"
    const safeName = params.fullName
      .trim()
      .replace(/[^a-zA-Z0-9 ]/g, '')   // strip special chars
      .replace(/\s+/g, '_');            // spaces → underscores

    const publicId = `${folder}/${safeName}_${params.orderId}_${Date.now()}`;

    this.logger.log(`Uploading receipt to Cloudinary: ${publicId}`);

    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          public_id:     publicId,
          resource_type: isPdf ? 'raw' : 'image',
          // Eager transformations only apply to images
          ...(isPdf ? {} : {
            transformation: [{ quality: 'auto', fetch_format: 'auto' }],
          }),
        },
        (error, result) => {
          if (error || !result) {
            reject(error ?? new Error('Cloudinary returned no result'));
          } else {
            resolve(result);
          }
        },
      );

      uploadStream.end(params.buffer);
    });

    this.logger.log(`Receipt uploaded: ${result.secure_url}`);
    return result.secure_url;
  }
}
