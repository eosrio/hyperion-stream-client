import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Get the project root directory
const projectRoot = path.resolve(process.cwd());

// Paths for files
const srcDir = path.join(projectRoot, 'src');
const srcZip = path.join(projectRoot, 'src.zip');
const readmePath = path.join(projectRoot, 'README.md');
const sourceMdPath = path.join(projectRoot, 'source.md');
const finalDocPath = path.join(projectRoot, 'FULL_DOCUMENTATION.md');

/**
 * Create a zip file of the src directory using PowerShell's Compress-Archive
 */
async function zipSrcFolder() {
  console.log('Zipping src folder...');

  try {
    // Check if src directory exists
    if (!fs.existsSync(srcDir)) {
      throw new Error('src directory not found');
    }

    // Remove existing zip file if it exists
    if (fs.existsSync(srcZip)) {
      fs.unlinkSync(srcZip);
    }

    // Use PowerShell's Compress-Archive to create the zip file
    const powershellCommand = `powershell -Command "Compress-Archive -Path '${srcDir}\\*' -DestinationPath '${srcZip}' -Force"`;

    const { stdout, stderr } = await execAsync(powershellCommand);

    if (stderr) {
      console.warn('PowerShell stderr:', stderr);
    }

    if (stdout) {
      console.log('PowerShell stdout:', stdout);
    }

    // Verify the zip file was created
    if (!fs.existsSync(srcZip)) {
      throw new Error('Failed to create zip file');
    }

    const stats = fs.statSync(srcZip);
    console.log(`Successfully created ${srcZip} (${stats.size} bytes)`);

    return true;
  } catch (error) {
    console.error('Error zipping src folder:', error);
    throw error;
  }
}

/**
 * Run markitdown on the zip file
 */
async function runMarkitdown() {
  console.log('Running markitdown on src.zip...');

  try {
    // Check if src.zip exists
    if (!fs.existsSync(srcZip)) {
      throw new Error('src.zip not found');
    }

    // Run markitdown command
    const { stdout, stderr } = await execAsync(`markitdown .\\src.zip -o source.md`);

    if (stderr) {
      console.warn('markitdown stderr:', stderr);
    }

    console.log('markitdown stdout:', stdout);
    console.log(`Successfully generated ${sourceMdPath}`);

    return true;
  } catch (error) {
    console.error('Error running markitdown:', error);

    // Check if markitdown is installed
    if (error.message.includes('not recognized') || error.message.includes('command not found')) {
      console.error('markitdown is not installed or not in PATH. Please install it first.');
      console.error('You can install it with: pip install markitdown');
    }

    throw error;
  }
}

/**
 * Combine README.md and source.md into a final document
 */
async function combineDocuments() {
  console.log('Combining README.md and source.md...');

  try {
    // Check if both files exist
    if (!fs.existsSync(readmePath)) {
      throw new Error('README.md not found');
    }

    if (!fs.existsSync(sourceMdPath)) {
      throw new Error('source.md not found');
    }

    // Read the content of both files
    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    const sourceMdContent = fs.readFileSync(sourceMdPath, 'utf8');

    // Combine the content
    const combinedContent = `${readmeContent}\n\n## Source Code Documentation\n\nThe following section contains the auto-generated documentation of the source code.\n\n${sourceMdContent}`;

    // Write the combined content to the final document
    fs.writeFileSync(finalDocPath, combinedContent);

    console.log(`Successfully generated ${finalDocPath}`);

    return true;
  } catch (error) {
    console.error('Error combining documents:', error);
    throw error;
  }
}

/**
 * Main function to run the entire process
 */
async function main() {
  try {
    console.log('Starting documentation generation process...');

    // Step 1: Zip the src folder
    await zipSrcFolder();

    // Step 2: Run markitdown on the zip file
    await runMarkitdown();

    // Step 3: Combine the documents
    await combineDocuments();

    console.log('Documentation generation completed successfully!');
  } catch (error) {
    console.error('Documentation generation failed:', error);
    process.exit(1);
  }
}

// Run the main function
main();
